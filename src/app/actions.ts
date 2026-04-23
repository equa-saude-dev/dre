'use server';

console.log('--- Server Actions Loaded ---');

import { getState as getLocalState } from '@/lib/storage';
import { DREState } from '@/lib/calc';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';

export async function fetchStateAction() {
  // Try to fetch from Supabase first
  const { data, error } = await supabase
    .from('dre_data')
    .select('state')
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.log('Supabase fetch error or empty, falling back to local:', error?.message);
    return await getLocalState();
  }
  
  console.log('Supabase fetch success');
  return data.state as DREState;
}

export async function saveStateAction(state: DREState) {
  console.log('saveStateAction called with state:', JSON.stringify(state).substring(0, 100) + '...');
  
  // 1. Try to save to Supabase
  const { data, error } = await supabase
    .from('dre_data')
    .upsert({ id: 1, state: state })
    .select();

  if (error) {
    console.error('Supabase save error:', error.message, error.details, error.hint);
    return { success: false, error: error.message };
  }

  console.log('Supabase save success:', data);
  revalidatePath('/');
  return { success: true };
}
