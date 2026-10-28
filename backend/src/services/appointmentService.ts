
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { AppointmentStatus } from '@prisma/client';

export const isValidTime = (time: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

interface CreateAppointmentData {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  appointmentDate: string;
  appointmentTime: string;
  purpose: string;
  notes?: string;
  branchId: string;
}

interface UpdateAppointmentData {
  status?: AppointmentStatus;
  appointmentDate?: string;
  appointmentTime?: string;
  notes?: string;
}

interface ListAppointmentsQuery {
  branchId?: string;
  status?: AppointmentStatus;
  date?: string;
  page?: number;
  limit?: number;
}

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export class AppointmentService {
  async createAppointment(data: CreateAppointmentData) {
    // Check if branch exists and is active
    const branch = await prisma.branch.findUnique({
      where: { id: data.branchId }
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    if (!branch.isActive) {
      throw new AppError(400, 'Branch is not accepting appointments');
    }

    // Validate time format
    if (
      !isValidTime(data.appointmentTime) ||
      !isValidTime(branch.openingTime) ||
      !isValidTime(branch.closingTime)
    ) {
      throw new AppError(400, 'Invalid time format');
    }

    // Validate branch hours
    const appointmentMinutes = toMinutes(data.appointmentTime);
    const openingMinutes = toMinutes(branch.openingTime);
    const closingMinutes = toMinutes(branch.closingTime);

    if (
      openingMinutes >= closingMinutes ||
      appointmentMinutes < openingMinutes ||
      appointmentMinutes >= closingMinutes
    ) {
      throw new AppError(
        400,
        `Appointments must be between ${branch.openingTime} and ${branch.closingTime}`
      );
    }

    // Check for conflicting appointments
    const conflictingAppointment = await prisma.appointment.findFirst({
      where: {
        branchId: data.branchId,
        appointmentDate: new Date(data.appointmentDate),
        appointmentTime: data.appointmentTime,
        status: {
          in: ['PENDING', 'CONFIRMED']
        }
      }
    });

    if (conflictingAppointment) {
      throw new AppError(409, 'This time slot is already booked');
    }

    const appointment = await prisma.appointment.create({
      data: {
        ...data,
        appointmentDate: new Date(data.appointmentDate),
        status: 'CONFIRMED'
      },
      include: {
        branch: true
      }
    });

    // Simulate sending confirmation
    logger.info(`Appointment confirmation sent to ${data.customerEmail}`, {
      appointmentId: appointment.id
    });

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { confirmationSent: true }
    });

    return appointment;
  }

  async getAppointment(id: string) {
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        branch: true
      }
    });

    if (!appointment) {
      throw new AppError(404, 'Appointment not found');
    }

    return appointment;
  }

  async listAppointments(query: ListAppointmentsQuery) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.date) {
      where.appointmentDate = new Date(query.date);
    }

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: {
          branch: true
        },
        orderBy: [
          { appointmentDate: 'asc' },
          { appointmentTime: 'asc' }
        ],
        skip,
        take: limit
      }),
      prisma.appointment.count({ where })
    ]);

    return {
      appointments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async updateAppointment(id: string, data: UpdateAppointmentData) {
    const existingAppointment = await this.getAppointment(id);

    // If updating date/time, check for conflicts
    if (data.appointmentDate || data.appointmentTime) {
      const conflictingAppointment = await prisma.appointment.findFirst({
        where: {
          branchId: existingAppointment.branchId,
          appointmentDate: data.appointmentDate
            ? new Date(data.appointmentDate)
            : existingAppointment.appointmentDate,
          appointmentTime:
            data.appointmentTime || existingAppointment.appointmentTime,
          status: {
            in: ['PENDING', 'CONFIRMED']
          },
          id: {
            not: id
          }
        }
      });

      if (conflictingAppointment) {
        throw new AppError(409, 'This time slot is already booked');
      }
    }

    const updateData: any = { ...data };

    if (data.appointmentDate) {
      updateData.appointmentDate = new Date(data.appointmentDate);
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: updateData,
      include: {
        branch: true
      }
    });

    return appointment;
  }

  async deleteAppointment(id: string) {
    await this.getAppointment(id);

    await prisma.appointment.delete({
      where: { id }
    });
  }

  async getAvailableTimeSlots(branchId: string, date: string) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId }
    });

    if (!branch) {
      throw new AppError(404, 'Branch not found');
    }

    const appointmentDate = new Date(date);
    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        branchId,
        appointmentDate,
        status: {
          in: ['PENDING', 'CONFIRMED']
        }
      },
      select: {
        appointmentTime: true
      }
    });

    const bookedTimes = bookedAppointments.map(a => a.appointmentTime);
    const openingMinutes = toMinutes(branch.openingTime);
    const closingMinutes = toMinutes(branch.closingTime);

    const availableSlots: string[] = [];

    for (
      let minutes = openingMinutes;
      minutes < closingMinutes;
      minutes += 60
    ) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const timeSlot = `${hour.toString().padStart(2, '0')}:${minute
        .toString()
        .padStart(2, '0')}`;

      if (!bookedTimes.includes(timeSlot)) {
        availableSlots.push(timeSlot);
      }
    }

    return availableSlots;
  }
}
