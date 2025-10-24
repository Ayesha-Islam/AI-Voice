import { Request, Response } from 'express';
import { container } from '../di/container';
import { AppointmentService } from '../services/appointment.services';
import { sendSuccess, handleAsync } from '../utils/helpers';
import { ValidationError } from '../utils/errors';
import { ServiceKeys } from '../di/interfaces';

export class AppointmentController {
    private appointmentService: AppointmentService;

    constructor() {
        this.appointmentService = container.get<AppointmentService>(ServiceKeys.APPOINTMENT);
    }

    // GET /api/appointments/slots
    getAvailableSlots = handleAsync(async (req: Request, res: Response) => {
        const { doctorId, date } = req.query;

        let targetDate: Date | undefined;
        if (date && typeof date === 'string') {
            targetDate = new Date(date);
            if (isNaN(targetDate.getTime())) {
                throw new ValidationError('Invalid date format');
            }
        }

        const slots = await this.appointmentService.findAvailableSlots(
            doctorId as string,
            targetDate
        );

        sendSuccess(res, slots);
    });

    // POST /api/appointments
    createAppointment = handleAsync(async (req: Request, res: Response) => {
        const { patientId, doctorId, dateTime, duration, reason } = req.body;

        if (!patientId || !doctorId || !dateTime || !reason) {
            throw new ValidationError('Missing required fields: patientId, doctorId, dateTime, reason');
        }

        const appointmentDate = new Date(dateTime);
        if (isNaN(appointmentDate.getTime())) {
            throw new ValidationError('Invalid date format');
        }

        const appointment = await this.appointmentService.createAppointment({
            patientId,
            doctorId,
            dateTime: appointmentDate,
            duration,
            reason
        });

        sendSuccess(res, appointment, 201);
    });

    // GET /api/doctors/:doctorId/appointments
    getDoctorAppointments = handleAsync(async (req: Request, res: Response) => {
        const { doctorId } = req.params;
        const { startDate, endDate } = req.query;

        let start: Date | undefined, end: Date | undefined;

        if (startDate && typeof startDate === 'string') {
            start = new Date(startDate);
            if (isNaN(start.getTime())) {
                throw new ValidationError('Invalid start date format');
            }
        }

        if (endDate && typeof endDate === 'string') {
            end = new Date(endDate);
            if (isNaN(end.getTime())) {
                throw new ValidationError('Invalid end date format');
            }
        }

        const appointments = await this.appointmentService.getDoctorAppointments(
            doctorId,
            start,
            end
        );

        sendSuccess(res, appointments);
    });

    // PATCH /api/appointments/:appointmentId/cancel
    cancelAppointment = handleAsync(async (req: Request, res: Response) => {
        const { appointmentId } = req.params;
        const { reason } = req.body;

        await this.appointmentService.cancelAppointment(appointmentId, reason);

        sendSuccess(res, { message: 'Appointment cancelled successfully' });
    });

    // PATCH /api/doctors/:doctorId/soft-delete
    softDeleteDoctor = handleAsync(async (req: Request, res: Response) => {
        const { doctorId } = req.params;

        await this.appointmentService.softDeleteDoctor(doctorId);

        sendSuccess(res, { message: 'Doctor soft deleted successfully' });
    });
}