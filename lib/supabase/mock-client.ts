// Interactive stateful in-memory database mock for local testing without Supabase connection.

const MOCK_SCHOOL_ID = 'a0000000-0000-0000-0000-000000000001';

// 1. Initial Seed Data
let mockUserProfiles = [
  { id: '10000000-0000-0000-0000-000000000001', role: 'admin', is_active: true, full_name: 'Suresh Sharma', email: 'admin@sunriseschool.edu', school_id: MOCK_SCHOOL_ID },
  { id: '10000000-0000-0000-0000-000000000002', role: 'driver', is_active: true, full_name: 'Ramesh Kumar', email: 'driver@school.edu', school_id: MOCK_SCHOOL_ID, phone: '+91-9876543211' },
  { id: '10000000-0000-0000-0000-000000000003', role: 'parent', is_active: true, full_name: 'Priya Gupta', email: 'priya@gmail.com', school_id: MOCK_SCHOOL_ID, phone: '+91-9876543212' },
  { id: '10000000-0000-0000-0000-000000000004', role: 'student', is_active: true, full_name: 'Raghav Gupta', email: 'raghav@school.edu', school_id: MOCK_SCHOOL_ID, phone: '+91-9876543213' }
];

let mockBuses = [
  { id: 'b0000000-0000-0000-0000-000000000001', school_id: MOCK_SCHOOL_ID, name: 'Bus 1 - Yellow Express', registration_plate: 'RJ14-AB-1234', capacity: 40, status: 'active' },
  { id: 'b0000000-0000-0000-0000-000000000002', school_id: MOCK_SCHOOL_ID, name: 'Bus 2 - Blue Star', registration_plate: 'RJ14-CD-5678', capacity: 35, status: 'active' }
];

let mockDrivers = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    user_id: '10000000-0000-0000-0000-000000000002',
    school_id: MOCK_SCHOOL_ID,
    bus_id: 'b0000000-0000-0000-0000-000000000001',
    license_number: 'DL-0420190000001',
    license_expiry: '2027-12-31',
    is_active: true
  }
];

let mockRoutes = [
  {
    id: 'r0000000-0000-0000-0000-000000000001',
    school_id: MOCK_SCHOOL_ID,
    bus_id: 'b0000000-0000-0000-0000-000000000001',
    name: 'Route A - Sector 5 to School',
    description: 'Morning pickup route from Sector 5',
    is_active: true
  }
];

let mockStops = [
  { id: 's0000000-0000-0000-0000-000000000000', route_id: 'r0000000-0000-0000-0000-000000000001', school_id: MOCK_SCHOOL_ID, name: 'School', address: 'Sunrise School Gate', latitude: 26.9124, longitude: 75.7873, stop_order: 0 },
  { id: 's0000000-0000-0000-0000-000000000001', route_id: 'r0000000-0000-0000-0000-000000000001', school_id: MOCK_SCHOOL_ID, name: 'Sector 5', address: 'Sector 5 Main Chowk', latitude: 26.9200, longitude: 75.8000, stop_order: 1 },
  { id: 's0000000-0000-0000-0000-000000000002', route_id: 'r0000000-0000-0000-0000-000000000001', school_id: MOCK_SCHOOL_ID, name: 'Green Park', address: 'Green Park Society Gate', latitude: 26.9250, longitude: 75.8050, stop_order: 2 },
  { id: 's0000000-0000-0000-0000-000000000003', route_id: 'r0000000-0000-0000-0000-000000000001', school_id: MOCK_SCHOOL_ID, name: 'Shiv Colony', address: 'Shiv Colony Bus Shelter', latitude: 26.9300, longitude: 75.8100, stop_order: 3 }
];

let mockStudentProfiles = [
  {
    id: 's0000000-0000-0000-0000-000000000004',
    user_id: '10000000-0000-0000-0000-000000000004',
    school_id: MOCK_SCHOOL_ID,
    bus_id: 'b0000000-0000-0000-0000-000000000001',
    stop_id: 's0000000-0000-0000-0000-000000000002',
    grade: '5A',
    roll_number: '2025-101'
  }
];

let mockParentProfiles = [
  {
    id: 'p0000000-0000-0000-0000-000000000003',
    user_id: '10000000-0000-0000-0000-000000000003',
    school_id: MOCK_SCHOOL_ID
  }
];

let mockParentStudentLinks = [
  { id: 'l0000000-0000-0000-0000-000000000001', parent_id: 'p0000000-0000-0000-0000-000000000003', student_id: 's0000000-0000-0000-0000-000000000004', relationship: 'mother' }
];

let mockTrips = [
  {
    id: 't0000000-0000-0000-0000-000000000001',
    bus_id: 'b0000000-0000-0000-0000-000000000001',
    driver_id: 'd0000000-0000-0000-0000-000000000001',
    route_id: 'r0000000-0000-0000-0000-000000000001',
    school_id: MOCK_SCHOOL_ID,
    status: 'active',
    started_at: new Date().toISOString()
  }
];

let mockBusLocations = [
  {
    id: 'loc-001',
    bus_id: 'b0000000-0000-0000-0000-000000000001',
    trip_id: 't0000000-0000-0000-0000-000000000001',
    latitude: 26.9200,
    longitude: 75.8000,
    speed: 30,
    heading: 90,
    recorded_at: new Date().toISOString()
  }
];

let mockAnnouncements = [
  {
    id: 'ann-001',
    school_id: MOCK_SCHOOL_ID,
    created_by: '10000000-0000-0000-0000-000000000001',
    title: 'Route Change Tomorrow',
    body: 'Bus 1 will take an alternate route due to road work. Please anticipate minor delays.',
    target_role: 'all',
    created_at: new Date().toISOString()
  }
];

async function getMockUserId(): Promise<string | undefined> {
  try {
    if (typeof window === 'undefined') {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      return cookieStore.get('mock-user-id')?.value;
    }
  } catch (e) {
    // Ignore error
  }
  if (typeof window !== 'undefined') {
    const match = document.cookie.match(new RegExp('(^| )mock-user-id=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : undefined;
  }
  return undefined;
}

// Helper to get matching profile nested details
function getEnrichedData(table: string, items: any[]) {
  if (table === 'buses') {
    return items.map(bus => ({
      ...bus,
      route: mockRoutes.find(r => r.bus_id === bus.id) || null,
      driver: (() => {
        const d = mockDrivers.find(dr => dr.bus_id === bus.id);
        if (!d) return null;
        const u = mockUserProfiles.find(up => up.id === d.user_id);
        return { ...d, user: u };
      })()
    }));
  }

  if (table === 'drivers') {
    return items.map(driver => ({
      ...driver,
      user: mockUserProfiles.find(up => up.id === driver.user_id),
      bus: mockBuses.find(b => b.id === driver.bus_id)
    }));
  }

  if (table === 'routes') {
    return items.map(route => ({
      ...route,
      bus: mockBuses.find(b => b.id === route.bus_id),
      stops: mockStops.filter(s => s.route_id === route.id)
    }));
  }

  if (table === 'student_profiles') {
    return items.map(student => ({
      ...student,
      user: mockUserProfiles.find(up => up.id === student.user_id),
      bus: mockBuses.find(b => b.id === student.bus_id),
      stop: mockStops.find(s => s.id === student.stop_id)
    }));
  }

  if (table === 'parent_profiles') {
    return items.map(parent => ({
      ...parent,
      user: mockUserProfiles.find(up => up.id === parent.user_id),
      students: mockParentStudentLinks
        .filter(l => l.parent_id === parent.id)
        .map(l => {
          const s = mockStudentProfiles.find(sp => sp.id === l.student_id);
          return s ? { ...s, user: mockUserProfiles.find(up => up.id === s.user_id) } : null;
        })
        .filter(Boolean)
    }));
  }

  if (table === 'trips') {
    return items.map(trip => ({
      ...trip,
      buses: mockBuses.find(b => b.id === trip.bus_id),
      drivers: (() => {
        const d = mockDrivers.find(dr => dr.id === trip.driver_id);
        return d ? { ...d, user_profiles: mockUserProfiles.find(up => up.id === d.user_id) } : null;
      })(),
      routes: mockRoutes.find(r => r.id === trip.route_id)
    }));
  }

  return items;
}

// 2. Chained Builder Class
class MockSupabaseQueryBuilder {
  private table: string;
  private filters: Record<string, any> = {};
  private insertData: any = null;
  private updateData: any = null;
  private isSingle = false;
  private isMaybeSingle = false;
  private limitCount: number | null = null;
  private deleteTriggered = false;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string, options?: any) {
    return this;
  }

  eq(column: string, value: any) {
    this.filters[column] = value;
    return this;
  }

  order(column: string, options?: any) {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  insert(data: any) {
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.updateData = data;
    return this;
  }

  delete() {
    this.deleteTriggered = true;
    return this;
  }

  private getTableArray(): any[] {
    switch (this.table) {
      case 'user_profiles': return mockUserProfiles;
      case 'buses': return mockBuses;
      case 'drivers': return mockDrivers;
      case 'routes': return mockRoutes;
      case 'stops': return mockStops;
      case 'student_profiles': return mockStudentProfiles;
      case 'parent_profiles': return mockParentProfiles;
      case 'parent_student_links': return mockParentStudentLinks;
      case 'trips': return mockTrips;
      case 'bus_locations': return mockBusLocations;
      case 'announcements': return mockAnnouncements;
      default: return [];
    }
  }

  private setTableArray(newArr: any[]) {
    switch (this.table) {
      case 'user_profiles': mockUserProfiles = newArr; break;
      case 'buses': mockBuses = newArr; break;
      case 'drivers': mockDrivers = newArr; break;
      case 'routes': mockRoutes = newArr; break;
      case 'stops': mockStops = newArr; break;
      case 'student_profiles': mockStudentProfiles = newArr; break;
      case 'parent_profiles': mockParentProfiles = newArr; break;
      case 'parent_student_links': mockParentStudentLinks = newArr; break;
      case 'trips': mockTrips = newArr; break;
      case 'bus_locations': mockBusLocations = newArr; break;
      case 'announcements': mockAnnouncements = newArr; break;
    }
  }

  async then(onfulfilled?: (value: any) => any) {
    let list = [...this.getTableArray()];

    // Apply Filter logic
    for (const [col, val] of Object.entries(this.filters)) {
      if (col === 'status' && val === 'active') {
        list = list.filter(item => item.status === 'active');
      } else if (col === 'is_active') {
        list = list.filter(item => item.is_active === val);
      } else if (col === 'user_id' || col === 'id' || col === 'parent_id' || col === 'student_id' || col === 'bus_id' || col === 'trip_id' || col === 'route_id') {
        list = list.filter(item => item[col] === val);
      }
    }

    let finalData: any = list;

    // Handle Write modifications
    if (this.insertData) {
      const entries = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
      const created = entries.map(item => ({
        id: item.id || `mock-id-${Math.random().toString(36).substr(2, 9)}`,
        created_at: new Date().toISOString(),
        ...item
      }));
      const current = this.getTableArray();
      this.setTableArray([...current, ...created]);
      finalData = Array.isArray(this.insertData) ? created : created[0];
    } else if (this.updateData) {
      const current = this.getTableArray();
      const updated = current.map(item => {
        let matches = true;
        for (const [col, val] of Object.entries(this.filters)) {
          if (item[col] !== val) matches = false;
        }
        return matches ? { ...item, ...this.updateData } : item;
      });
      this.setTableArray(updated);
      finalData = Array.isArray(this.updateData) ? this.updateData : { ...list[0], ...this.updateData };
    } else if (this.deleteTriggered) {
      const current = this.getTableArray();
      const filtered = current.filter(item => {
        let matches = true;
        for (const [col, val] of Object.entries(this.filters)) {
          if (item[col] !== val) matches = false;
        }
        return !matches;
      });
      this.setTableArray(filtered);
      finalData = null;
    }

    if (!this.insertData && !this.updateData && !this.deleteTriggered) {
      finalData = getEnrichedData(this.table, finalData);
    }

    if (this.limitCount !== null) {
      finalData = finalData.slice(0, this.limitCount);
    }

    if (this.isSingle) {
      finalData = finalData[0] || null;
    } else if (this.isMaybeSingle) {
      finalData = finalData[0] || null;
    }

    const res = {
      data: finalData,
      error: null,
      count: Array.isArray(finalData) ? finalData.length : finalData ? 1 : 0
    };

    if (onfulfilled) return onfulfilled(res);
    return res;
  }
}

// 3. Client Mock wrapper
export function createMockSupabaseClient() {
  return {
    auth: {
      getUser: async () => {
        const userId = await getMockUserId();
        const u = mockUserProfiles.find(up => up.id === userId);
        if (!u) return { data: { user: null }, error: { message: 'No session' } };
        return { data: { user: { id: u.id, email: u.email } }, error: null };
      },
      signInWithPassword: async ({ email }: { email: string }) => {
        const u = mockUserProfiles.find(up => up.email === email);
        if (!u) return { data: { user: null }, error: { message: 'Invalid credentials' } };
        if (typeof window !== 'undefined') {
          document.cookie = `mock-user-id=${u.id}; path=/; max-age=86400`;
        } else {
          try {
            const { cookies } = await import('next/headers');
            const cookieStore = await cookies();
            cookieStore.set('mock-user-id', u.id, { path: '/', maxAge: 86400 });
          } catch (e) {}
        }
        return { data: { user: { id: u.id, email: u.email } }, error: null };
      },
      signOut: async () => {
        if (typeof window !== 'undefined') {
          document.cookie = 'mock-user-id=; path=/; max-age=0';
        } else {
          try {
            const { cookies } = await import('next/headers');
            const cookieStore = await cookies();
            cookieStore.delete('mock-user-id');
          } catch (e) {}
        }
        return { error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          return { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null };
        },
        listFactors: async () => {
          return { data: { totp: [{ id: 'mock-totp', status: 'verified' }] }, error: null };
        },
        challenge: async () => {
          return { data: { id: 'mock-challenge' }, error: null };
        },
        verify: async () => {
          return { data: { success: true }, error: null };
        }
      }
    },
    from: (table: string) => {
      return new MockSupabaseQueryBuilder(table);
    },
    channel: (name: string) => {
      const mockChan = {
        on: (event: string, filter: any, callback: (payload: any) => void) => {
          return mockChan;
        },
        subscribe: () => {
          return mockChan;
        }
      };
      return mockChan;
    },
    removeChannel: (channel: any) => {
      return { error: null };
    }
  };
}
