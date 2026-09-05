import { z } from 'zod';

export const PasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/, 'Password must contain at least one uppercase letter, one number, and one special character');

export const CreateUserSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  username: z.string().min(2, 'Username must be at least 2 characters').max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens').optional().nullable().or(z.literal('')),
  email: z.string().email('Enter a valid email address').max(254, 'Email must not exceed 254 characters'),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number').optional().nullable().or(z.literal('')),
  password: PasswordSchema,
  role: z.enum(['admin', 'manager', 'supervisor', 'worker']).default('worker'),
  plant_id: z.string().uuid().optional().nullable().or(z.literal('')),
  supervisor_id: z.string().uuid().optional().nullable().or(z.literal('')),
  is_active: z.boolean().optional().default(false),
  location_interval: z.coerce.number().int().min(1, 'Interval must be at least 1 second').max(3600, 'Interval cannot exceed 1 hour').optional(),
});

export const UpdateUserSchema = CreateUserSchema.extend({
  password: PasswordSchema.optional().nullable().or(z.literal('')),
});

export const PlantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  code: z.string().min(1, 'Code is required').max(20),
  address: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_meters: z.coerce.number().min(1).max(50000).default(100),
});

// GPS locations bounds for validation (restricted to India bounds as specified in security.md)
const INDIA_BOUNDS = {
  lat: { min: 6.0, max: 37.6 },
  lng: { min: 68.0, max: 97.4 },
};

export const LocationSchema = z.object({
  latitude: z.coerce.number()
    .min(INDIA_BOUNDS.lat.min, 'Latitude must be between 6.0 and 37.6 (India bounds)')
    .max(INDIA_BOUNDS.lat.max, 'Latitude must be between 6.0 and 37.6 (India bounds)'),
  longitude: z.coerce.number()
    .min(INDIA_BOUNDS.lng.min, 'Longitude must be between 68.0 and 97.4 (India bounds)')
    .max(INDIA_BOUNDS.lng.max, 'Longitude must be between 68.0 and 97.4 (India bounds)'),
  speed: z.coerce.number().min(0).max(200).default(0),
  heading: z.coerce.number().min(0).max(360).default(0),
  accuracy: z.coerce.number().min(0).max(5000).default(0),
  battery_level: z.coerce.number().int().min(0).max(100).optional().nullable(),
  is_tracking: z.boolean().optional().default(true),
});

export const LoginSchema = z.object({
  identifier: z.string().min(2, 'Username or Email is required').max(254),
  email: z.string().optional(),
  password: z.string().min(1, 'Password is required').max(128, 'Password must not exceed 128 characters'),
  ip: z.string().optional(),
});

export const BulkImportRowSchema = z.object({
  role: z.enum(['manager', 'supervisor', 'worker']),
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Enter a valid email address').max(254),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number').optional().nullable().or(z.literal('')),
  password: z.string().optional().nullable().or(z.literal('')),
  plant_code: z.string().min(1, 'Plant code is required'),
  supervisor_email: z.string().email('Enter a valid supervisor email address').optional().nullable().or(z.literal('')).or(z.literal('null')),
});
