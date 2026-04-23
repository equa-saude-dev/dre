'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Use 'any' for the component to avoid strict plotly type issues in dynamic import
const Plot = dynamic(() => import('react-plotly.js'), { 
  ssr: false,
  loading: () => <div className="chart-loading">Carregando gráfico...</div>
}) as any;

export default Plot;
