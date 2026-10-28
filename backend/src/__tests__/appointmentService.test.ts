import { AppError } from '../middleware/errorHandler';
import { isValidTime } from '../services/appointmentService';

describe('AppError', () => {
  it('should create an AppError with correct properties', () => {
    const error = new AppError(404, 'Not found');
    
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Not found');
    expect(error.isOperational).toBe(true);
  });

  it('should set isOperational to false when specified', () => {
    const error = new AppError(500, 'Server error', false);
    
    expect(error.isOperational).toBe(false);
  });
});
describe('isValidTime', () => {
  it.each(['09:00', '12:30', '16:59', '00:00', '23:59'])(
    'accepts valid time %s',
    (time) => {
      expect(isValidTime(time)).toBe(true);
    }
  );

  it.each(['16:90', '25:00', 'abc', '9:00', '12:60', ''])(
    'rejects invalid time %s',
    (time) => {
      expect(isValidTime(time)).toBe(false);
    }
  );
});
