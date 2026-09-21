const { createClient } = require('@supabase/supabase-js');

const url = 'https://zbudxpbtlbfutaxxzpvq.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidWR4cGJ0bGJmdXRheHh6cHZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NTM3MTQsImV4cCI6MjEwMjQyOTcxNH0.GE6BI5poiW67lkaDSqLJZq1VTwB2UPNJ1D1WcWyVVMs';

const supabase = createClient(url, key);

async function test() {
  console.log('--- Testing tbl_sessions ---');
  const { data: sData, error: sErr } = await supabase.from('tbl_sessions').select('*').limit(1);
  console.log('tbl_sessions:', { sData, sErr });

  console.log('--- Testing tbl_athletes ---');
  const { data: aData, error: aErr } = await supabase.from('tbl_athletes').select('*').limit(1);
  if (aData && aData[0]) {
    console.log('tbl_athletes sample keys:', Object.keys(aData[0]));
    console.log('tbl_athletes sample row:', aData[0]);
  } else {
    console.log('tbl_athletes error or empty:', aErr);
  }

  console.log('--- Testing tbl_session_attendees ---');
  const { data: saData, error: saErr } = await supabase.from('tbl_session_attendees').select('*').limit(1);
  console.log('tbl_session_attendees:', { saData, saErr });

  console.log('--- Testing tbl_session_athletes ---');
  const { data: sbData, error: sbErr } = await supabase.from('tbl_session_athletes').select('*').limit(1);
  console.log('tbl_session_athletes:', { sbData, sbErr });
}

test();
