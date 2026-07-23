const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qnhyozxzskhnncgoplfb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaHlvenh6c2tobm5jZ29wbGZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjM3NTYyMiwiZXhwIjoyMDk3OTUxNjIyfQ.nod2IEacfFOoIxpeT6DZoKzUmmFxhsDybConNqU1tHY'
);

async function testInsert() {
  console.log('Fetching a driver to get valid user_id and school_id...');
  const { data: driver, error: driverErr } = await supabase
    .from('drivers')
    .select('id, user_id, school_id')
    .limit(1)
    .single();

  if (driverErr || !driver) {
    console.error('Error fetching driver:', driverErr);
    return;
  }
  console.log('Using driver:', driver);

  console.log('Inserting notification...');
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      school_id: driver.school_id,
      title: '📶 Driver GPS Interrupted',
      message: 'Test Driver: GPS connection timeout.',
      type: 'gps_off',
    })
    .select()
    .single();

  if (error) {
    console.error('Error inserting notification:', error);
  } else {
    console.log('Successfully inserted notification:', data);
  }
}

testInsert();
