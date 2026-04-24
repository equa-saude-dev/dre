'use server';

import { DREState } from '@/lib/calc';
import { supabase } from '@/lib/supabase';

export async function saveStateAction(state: DREState) {
  const { error } = await supabase
    .from('dre_data')
    .upsert({ id: 1, state: state });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
