// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { logger } from '../src/utils/logger';

const prisma = new PrismaClient();

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function getNextWeekday(dayOfWeek: number): Date {
  const today = new Date();
  const currentDay = today.getDay();
  const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7 || 7;
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntilTarget);
  targetDate.setHours(10, 0, 0, 0);
  return targetDate;
}

async function main() {
  logger.info('🌱 Starting database seed...');

  try {
    // Clear existing data (optional - be careful in production)
    if (process.env.NODE_ENV === 'development') {
      // Run safe deleteMany calls, skip if model/table missing
      const deletes = [
        'auditLog',
        'conversationContext',
        'callLog',
        'appointment',
        'doctorAvailability',
        'patient',
        'doctor'
      ];

      for (const model of deletes) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c: any = prisma;
          if (c[model] && typeof c[model].deleteMany === 'function') {
            await c[model].deleteMany();
          }
        } catch (err) {
          logger.warn(`Skipping deleteMany for ${model}:`, (err as Error).message);
        }
      }
    }

    // Create Doctors
    logger.info('📋 Creating doctors...');

    const doctors = await Promise.all([
      prisma.doctor.upsert({
        where: { email: 'dr.smith@healthcare.com' },
        update: {},
        create: {
          name: 'Dr. Sarah Smith',
          email: 'dr.smith@healthcare.com',
          specialization: 'General Practice',
          phoneNumber: '+1234567890',
          isActive: true,
        },
      }),
      prisma.doctor.upsert({
        where: { email: 'dr.johnson@healthcare.com' },
        update: {},
        create: {
          name: 'Dr. Michael Johnson',
          email: 'dr.johnson@healthcare.com',
          specialization: 'Cardiology',
          phoneNumber: '+1234567891',
          isActive: true,
        },
      }),
      prisma.doctor.upsert({
        where: { email: 'dr.williams@healthcare.com' },
        update: {},
        create: {
          name: 'Dr. Emily Williams',
          email: 'dr.williams@healthcare.com',
          specialization: 'Pediatrics',
          phoneNumber: '+1234567892',
          isActive: true,
        },
      })
    ]);

    logger.info(`✓ Created ${doctors.length} doctors`);

    // Create Patients
    logger.info('👥 Creating patients...');

    const patients = await Promise.all([
      prisma.patient.upsert({
        where: { phoneNumber: '+1234567893' },
        update: {},
        create: {
          phoneNumber: '+1234567893',
          name: 'John Doe',
          email: 'john.doe@example.com',
          dateOfBirth: new Date('1985-05-15'),
        },
      }),
      prisma.patient.upsert({
        where: { phoneNumber: '+1234567894' },
        update: {},
        create: {
          phoneNumber: '+1234567894',
          name: 'Jane Smith',
          email: 'jane.smith@example.com',
          dateOfBirth: new Date('1990-08-22'),
        },
      })
    ]);

    logger.info(`✓ Created ${patients.length} patients`);

    // Create Appointments outside the transaction to avoid transaction timeout
    logger.info('📅 Creating sample appointments...');

    const appointment1DateTime = getNextWeekday(1); // Next Monday
    const appointment2DateTime = getNextWeekday(2); // Next Tuesday
    appointment2DateTime.setHours(14, 0, 0, 0);

    await Promise.all([
      prisma.appointment.upsert({
        where: {
          doctorId_dateTime: {
            doctorId: doctors[0].id,
            dateTime: appointment1DateTime,
          },
        },
        update: {},
        create: {
          patientId: patients[0].id,
          doctorId: doctors[0].id,
          dateTime: appointment1DateTime,
          duration: 30,
          reason: 'Annual checkup',
          status: 'scheduled',
        },
      }),
      prisma.appointment.upsert({
        where: {
          doctorId_dateTime: {
            doctorId: doctors[1].id,
            dateTime: appointment2DateTime,
          },
        },
        update: {},
        create: {
          patientId: patients[1].id,
          doctorId: doctors[1].id,
          dateTime: appointment2DateTime,
          duration: 45,
          reason: 'Cardiology consultation',
          status: 'confirmed',
        },
      })
    ]);

    logger.info('✓ Created sample appointments');

    // Create Availability outside the transaction to avoid transaction timeout
    logger.info('📅 Creating doctor availability...');
    const workdays = [1, 2, 3, 4, 5]; // Monday to Friday
    const availabilityPromises: Array<Promise<any>> = [];

    for (const doctor of doctors) {
      for (const day of workdays) {
        availabilityPromises.push(
          prisma.doctorAvailability.upsert({
            where: {
              doctorId_dayOfWeek_startTime_endTime: {
                doctorId: doctor.id,
                dayOfWeek: day,
                startTime: timeToMinutes('09:00'),
                endTime: timeToMinutes('17:00'),
              },
            },
            update: { isActive: true },
            create: {
              doctorId: doctor.id,
              dayOfWeek: day,
              startTime: timeToMinutes('09:00'),
              endTime: timeToMinutes('17:00'),
              isActive: true,
            },
          })
        );
      }
    }

    await Promise.all(availabilityPromises);
    logger.info(`✓ Created ${availabilityPromises.length} availability slots`);

    // Summary
    const doctorCount = await prisma.doctor.count();
    const patientCount = await prisma.patient.count();
    const availabilityCount = await prisma.doctorAvailability.count();
    const appointmentCount = await prisma.appointment.count();

    logger.info('\n🎉 Seeding completed successfully!');
    logger.info('📊 Summary:');
    logger.info(`   - Doctors: ${doctorCount}`);
    logger.info(`   - Patients: ${patientCount}`);
    logger.info(`   - Availability slots: ${availabilityCount}`);
    logger.info(`   - Appointments: ${appointmentCount}`);
    logger.info('\n✨ Database is ready for use!');

  } catch (error) {
    logger.error('❌ Error during seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    logger.error('❌ Fatal seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });