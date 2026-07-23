const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://qnhyozxzskhnncgoplfb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaHlvenh6c2tobm5jZ29wbGZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjM3NTYyMiwiZXhwIjoyMDk3OTUxNjIyfQ.nod2IEacfFOoIxpeT6DZoKzUmmFxhsDybConNqU1tHY'
);

async function check() {
  console.log('Querying public.notifications table...');
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .limit(5);

  if (error) {
    console.error('Error fetching from notifications:', error);
  } else {
    console.log('Successfully fetched from notifications table. Count:', data.length);
    console.log('Data:', data);
  }
}

check();
