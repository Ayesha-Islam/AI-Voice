import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors';


export interface CreateAppointmentData {
    patientId: string;
    doctorId: string;
    dateTime: Date;
    duration?: number;
    reason: string;
}

export interface AvailableSlot {
    doctorId: string;
    doctorName: string;
    specialization: string;
    startTime: Date;
    endTime: Date;
}

export class AppointmentService {
    constructor(private prisma: PrismaClient) { }

    async createAppointment(data: CreateAppointmentData): Promise<any> {
        try {
            // Validate input
            if (data.dateTime < new Date()) {
                throw new ValidationError('Appointment date cannot be in the past');
            }

            if (data.duration && data.duration <= 0) {
                throw new ValidationError('Duration must be positive');
            }

            // Check if doctor exists and is active (defensive: schema may vary)
            const doctor = await this.prisma.doctor.findUnique({ where: { id: data.doctorId } });
            if (!doctor) {
                throw new NotFoundError('Doctor', data.doctorId);
            }
            // If schema includes `isAvailable` or `isActive`, enforce it
            // (use in-operator to avoid runtime errors with older schemas)
            // If neither exists assume doctor is active.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dAny = doctor as any;
            if ('isAvailable' in dAny && !dAny.isAvailable) {
                throw new NotFoundError('Doctor', data.doctorId);
            }
            if ('isActive' in dAny && !dAny.isActive) {
                throw new NotFoundError('Doctor', data.doctorId);
            }

            if (!doctor) {
                throw new NotFoundError('Doctor', data.doctorId);
            }

            // Check if patient exists (defensive)
            const patient = await this.prisma.patient.findUnique({ where: { id: data.patientId } });
            if (!patient) {
                throw new NotFoundError('Patient', data.patientId);
            }
            // If schema includes isActive, enforce it
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pAny = patient as any;
            if ('isActive' in pAny && !pAny.isActive) {
                throw new NotFoundError('Patient', data.patientId);
            }

            // Check for conflicting appointments by fetching candidate appointments
            // and performing a proper interval-overlap check in-memory.
            const newStart = data.dateTime;
            const newEnd = new Date(newStart.getTime() + (data.duration || 30) * 60000);

            // Fetch appointments that start before newEnd (this includes appointments
            // that could overlap). We limit to scheduled/confirmed statuses.
            const candidates = await this.prisma.appointment.findMany({
                where: {
                    doctorId: data.doctorId,
                    status: { in: ['scheduled', 'confirmed'] },
                    dateTime: { lt: newEnd }
                }
            });

            const overlaps = candidates.find((existing) => {
                const existingStart = existing.dateTime;
                const existingDuration = existing.duration || 30;
                const existingEnd = new Date(existingStart.getTime() + existingDuration * 60000);

                // Overlap exists when existingStart < newEnd && existingEnd > newStart
                return existingStart < newEnd && existingEnd > newStart;
            });

            if (overlaps) {
                throw new ConflictError('Time slot already booked');
            }

            // Create appointment within transaction
            const appointment = await this.prisma.$transaction(async (tx) => {
                const appointment = await tx.appointment.create({
                    data: {
                        patientId: data.patientId,
                        doctorId: data.doctorId,
                        dateTime: data.dateTime,
                        duration: data.duration || 30,
                        reason: data.reason,
                        status: 'scheduled'
                    },
                    include: {
                        doctor: true,
                        patient: true
                    }
                });

                // Log the creation (audit table may or may not exist in generated client)
                // Use any cast to avoid type mismatches with generated client shapes.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const txAny = tx as any;
                if (txAny.auditLog && typeof txAny.auditLog.create === 'function') {
                    await txAny.auditLog.create({
                        data: {
                            entityType: 'Appointment',
                            entityId: appointment.id,
                            action: 'CREATE',
                            changes: data,
                            userId: 'system'
                        }
                    });
                }

                return appointment;
            });

            logger.info(`Appointment created: ${appointment.id}`);
            return appointment;

        } catch (error) {
            logger.error('Error creating appointment:', error);
            throw error;
        }
    }

    async findAvailableSlots(doctorId?: string, date?: Date): Promise<AvailableSlot[]> {
        try {
            const targetDate = date || new Date();
            targetDate.setHours(0, 0, 0, 0);

            const dayOfWeek = targetDate.getDay();

            const whereClause: any = {
                isActive: true,
                dayOfWeek: dayOfWeek,
                doctor: {
                    isActive: true,
                    deletedAt: null
                }
            };

            if (doctorId) {
                whereClause.doctorId = doctorId;
            }

            const availability = await this.prisma.doctorAvailability.findMany({
                where: whereClause,
                include: { doctor: true }
            });

            const slots: AvailableSlot[] = [];
            const appointmentDuration = 30; // minutes

            // Helper: convert availability start/end to minutes since midnight.
            const toMinutes = (val: any): number => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') {
                    // 'HH:MM' -> minutes
                    const parts = val.split(':').map(Number);
                    if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
                        return parts[0] * 60 + parts[1];
                    }
                }
                if (val instanceof Date) return val.getHours() * 60 + val.getMinutes();
                // fallback
                return 0;
            };

            // Batch fetch appointments for all relevant doctors for the target day
            const doctorIds = Array.from(new Set(availability.map(a => a.doctorId)));
            const dayStart = new Date(targetDate);
            const dayEnd = new Date(targetDate);
            dayEnd.setDate(dayEnd.getDate() + 1);

            const appointments = doctorIds.length > 0 ? await this.prisma.appointment.findMany({
                where: {
                    doctorId: { in: doctorIds },
                    status: { in: ['scheduled', 'confirmed'] },
                    dateTime: { gte: dayStart, lt: dayEnd }
                }
            }) : [];

            for (const avail of availability) {
                const startMin = toMinutes(avail.startTime);
                const endMin = toMinutes(avail.endTime);

                let currentMin = startMin;
                while (currentMin + appointmentDuration <= endMin) {
                    const slotStart = new Date(targetDate);
                    slotStart.setHours(Math.floor(currentMin / 60), currentMin % 60, 0, 0);

                    const slotEnd = new Date(slotStart);
                    slotEnd.setMinutes(slotStart.getMinutes() + appointmentDuration);

                    // Skip past slots
                    if (slotStart < new Date()) {
                        currentMin += appointmentDuration;
                        continue;
                    }

                    const hasAppointment = appointments.some(ap => {
                        return ap.doctorId === avail.doctorId && ap.dateTime.getTime() === slotStart.getTime();
                    });

                    if (!hasAppointment) {
                        slots.push({
                            doctorId: avail.doctorId,
                            doctorName: avail.doctor.name,
                            specialization: avail.doctor.specialization,
                            startTime: slotStart,
                            endTime: slotEnd
                        });
                    }

                    currentMin += appointmentDuration;
                }
            }

            return slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        } catch (error) {
            logger.error('Error finding available slots:', error);
            throw error;
        }
    }

    async softDeleteDoctor(doctorId: string): Promise<void> {
        try {
            // Check if doctor exists
            const doctor = await this.prisma.doctor.findUnique({
                where: { id: doctorId }
            });

            if (!doctor) {
                throw new NotFoundError('Doctor', doctorId);
            }

            // Use transaction to ensure data consistency
            await this.prisma.$transaction(async (tx) => {
                // Soft delete doctor - cast tx to any to avoid generated-client type mismatch
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const txAny = tx as any;

                // Update doctor: prefer isActive, fall back to isAvailable if present
                const doctorUpdate: any = {};
                doctorUpdate.deletedAt = new Date();
                doctorUpdate.isActive = false;
                // If generated client does not accept isActive, try isAvailable
                try {
                    await txAny.doctor.update({ where: { id: doctorId }, data: doctorUpdate });
                } catch (err) {
                    // try fallback: set isAvailable instead
                    const fallbackUpdate: any = { deletedAt: new Date(), isAvailable: false };
                    try {
                        await txAny.doctor.update({ where: { id: doctorId }, data: fallbackUpdate });
                    } catch (innerErr) {
                        // Re-throw the original error to let outer catch handle it
                        throw err;
                    }
                }

                // Deactivate availability slots
                await txAny.doctorAvailability.updateMany({ where: { doctorId }, data: { isActive: false } });

                // Cancel future appointments
                await txAny.appointment.updateMany({
                    where: {
                        doctorId,
                        dateTime: { gt: new Date() },
                        status: { in: ['scheduled', 'confirmed'] }
                    },
                    data: { status: 'cancelled' }
                });

                // Log the action if audit table exists on client
                if (txAny.auditLog && typeof txAny.auditLog.create === 'function') {
                    await txAny.auditLog.create({
                        data: {
                            entityType: 'Doctor',
                            entityId: doctorId,
                            action: 'SOFT_DELETE',
                            changes: { deletedAt: new Date().toISOString() },
                            userId: 'system'
                        }
                    });
                }
            });

            logger.info(`Soft deleted doctor: ${doctorId}`);

        } catch (error) {
            logger.error('Error soft deleting doctor:', error);
            throw error;
        }
    }

    async getDoctorAppointments(doctorId: string, startDate?: Date, endDate?: Date): Promise<any[]> {
        try {
            const whereClause: any = {
                doctorId,
                doctor: {
                    deletedAt: null
                }
            };

            if (startDate || endDate) {
                whereClause.dateTime = {};
                if (startDate) whereClause.dateTime.gte = startDate;
                if (endDate) whereClause.dateTime.lte = endDate;
            }

            return await this.prisma.appointment.findMany({
                where: whereClause,
                include: {
                    patient: true
                },
                orderBy: {
                    dateTime: 'asc'
                }
            });
        } catch (error) {
            logger.error('Error getting doctor appointments:', error);
            throw error;
        }
    }

    async cancelAppointment(appointmentId: string, reason?: string): Promise<void> {
        try {
            const appointment = await this.prisma.appointment.findUnique({
                where: { id: appointmentId }
            });

            if (!appointment) {
                throw new NotFoundError('Appointment', appointmentId);
            }

            await this.prisma.appointment.update({
                where: { id: appointmentId },
                data: {
                    status: 'cancelled',
                    notes: reason ? `${appointment.notes || ''}\nCancelled: ${reason}`.trim() : appointment.notes
                }
            });

            logger.info(`Appointment cancelled: ${appointmentId}`);
        } catch (error) {
            logger.error('Error cancelling appointment:', error);
            throw error;
        }
    }
}