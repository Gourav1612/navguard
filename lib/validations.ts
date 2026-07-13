import { z } from 'zod';

export const BusSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  registration_plate: z.string().min(1, 'Registration plate is required').max(20),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(150, 'Capacity cannot exceed 150'),
  status: z.enum(['active', 'inactive', 'maintenance']).optional().default('inactive'),
});

export const RouteSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  bus_id: z.string().uuid().optional().nullable().or(z.literal('')),
  description: z.string().optional().nullable(),
  is_active: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional().default(true),
  stops: z.array(z.object({
    name: z.string().min(1, 'Stop name is required'),
    address: z.string().optional().nullable(),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    stop_order: z.coerce.number().int().min(0),
  })).optional(),
});

export const StopSchema = z.object({
  route_id: z.string().uuid(),
  name: z.string().min(1, 'Stop name is required').max(100),
  address: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  stop_order: z.coerce.number().int().min(0),
});

export const CreateUserSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Enter a valid email address').max(254, 'Email must not exceed 254 characters'),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number').optional().nullable(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/, 'Password must contain at least one uppercase letter, one number, and one special character'),
  is_active: z.boolean().optional(),
});

// Driver details on top of CreateUserSchema
export const CreateDriverSchema = CreateUserSchema.extend({
  license_number: z.string().min(1, 'License number is required'),
  license_expiry: z.string().optional().nullable(), // YYYY-MM-DD
  bus_id: z.string().uuid().optional().nullable().or(z.literal('')),
});

// Parent details on top of CreateUserSchema
export const CreateParentSchema = CreateUserSchema.extend({
  student_ids: z.array(z.string().uuid()).optional().default([]),
});

// Student details on top of CreateUserSchema
export const CreateStudentSchema = CreateUserSchema.extend({
  grade: z.string().min(1, 'Grade is required'),
  roll_number: z.string().min(1, 'Roll number is required'),
  bus_id: z.string().uuid().optional().nullable().or(z.literal('')),
  stop_id: z.string().uuid().optional().nullable().or(z.literal('')),
});

// Assignments
export const StudentBusAssignmentSchema = z.object({
  student_id: z.string().uuid(),
  bus_id: z.string().uuid().optional().nullable().or(z.literal('')),
  stop_id: z.string().uuid().optional().nullable().or(z.literal('')),
});

export const DriverBusAssignmentSchema = z.object({
  driver_id: z.string().uuid(),
  bus_id: z.string().uuid().optional().nullable().or(z.literal('')),
});

// GPS locations bounds for validation (restricted to India bounds as specified in security.md)
const INDIA_BOUNDS = {
  lat: { min: 6.0, max: 37.6 },
  lng: { min: 68.0, max: 97.4 },
};

export const LocationSchema = z.object({
  bus_id: z.string().uuid(),
  trip_id: z.string().uuid(),
  latitude: z.coerce.number()
    .min(INDIA_BOUNDS.lat.min, 'Latitude must be between 6.0 and 37.6 (India bounds)')
    .max(INDIA_BOUNDS.lat.max, 'Latitude must be between 6.0 and 37.6 (India bounds)'),
  longitude: z.coerce.number()
    .min(INDIA_BOUNDS.lng.min, 'Longitude must be between 68.0 and 97.4 (India bounds)')
    .max(INDIA_BOUNDS.lng.max, 'Longitude must be between 68.0 and 97.4 (India bounds)'),
  speed: z.coerce.number().min(0).max(200).default(0),
  heading: z.coerce.number().min(0).max(360).default(0),
});

export const LoginSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254, 'Email must not exceed 254 characters'),
  password: z.string().min(1, 'Password is required').max(128, 'Password must not exceed 128 characters'),
  ip: z.string().optional(),
});

export const AnnouncementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(150),
  body: z.string().min(1, 'Body is required'),
  target_role: z.enum(['all', 'parent', 'student', 'driver']).default('all'),
});

export const BulkImportRowSchema = z.object({
  role: z.enum(['driver', 'parent', 'student']),
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Enter a valid email address').max(254),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number').optional().nullable().or(z.literal('')),
  password: z.string().optional().nullable().or(z.literal('')),
  
  // Driver specific
  license_number: z.string().optional().nullable().or(z.literal('')),
  license_expiry: z.string().optional().nullable().or(z.literal('')),
  
  // Student specific
  grade: z.string().optional().nullable().or(z.literal('')),
  roll_number: z.string().optional().nullable().or(z.literal('')),
  parent_email: z.string().email('Enter a valid parent email address').optional().nullable().or(z.literal('')).or(z.literal('null')),
});
