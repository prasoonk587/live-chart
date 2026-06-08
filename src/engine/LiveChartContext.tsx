import { createContext, useContext } from 'react';
import { LiveChart } from './LiveChart';

export const LiveChartContext = createContext<LiveChart | null>(null);

export function useLiveChartInstance(): LiveChart {
  const chart = useContext(LiveChartContext);
  if (!chart) throw new Error('useLiveChartInstance must be used inside LiveChartContext.Provider');
  return chart;
}
