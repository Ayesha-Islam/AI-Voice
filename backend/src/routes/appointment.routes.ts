import { Router } from 'express';
import { AppointmentController } from '../controllers/appointment.controller';
import { validateRequestBody } from '../middleware/validation.middleware';

const router = Router();
const appointmentController = new AppointmentController();

// GET /api/appointments/slots - Get available appointment slots
router.get('/slots', appointmentController.getAvailableSlots);

// POST /api/appointments - Create new appointment
router.post(
    '/',
    validateRequestBody(['patientId', 'doctorId', 'dateTime', 'reason']),
    appointmentController.createAppointment
);

// GET /api/doctors/:doctorId/appointments - Get doctor's appointments
router.get('/doctors/:doctorId/appointments', appointmentController.getDoctorAppointments);

// PATCH /api/appointments/:appointmentId/cancel - Cancel appointment
router.patch('/:appointmentId/cancel', appointmentController.cancelAppointment);

// PATCH /api/doctors/:doctorId/soft-delete - Soft delete doctor
router.patch('/doctors/:doctorId/soft-delete', appointmentController.softDeleteDoctor);

export default router;