export type PasteurTrendTone = 'purple' | 'cyan' | 'green' | 'orange' | 'success';

export interface PasteurKpi {
  label: string;
  value: string;
  unit?: string;
  helper: string;
  icon: string;
  tone: PasteurTrendTone;
  trend: number[];
}

export interface PasteurReferenceLine {
  label: string;
  value: number;
  tone: 'min' | 'target' | 'max';
}

export interface PasteurChart {
  title: string;
  subtitle?: string;
  unit: string;
  currentValue: string;
  minLabel?: string;
  targetLabel?: string;
  maxLabel?: string;
  tone: PasteurTrendTone;
  values: number[];
  min: number;
  max: number;
  referenceLines?: PasteurReferenceLine[];
  times: string[];
  timestamps?: number[];
  xMinMs?: number;
  xMaxMs?: number;
  latestTimestampMs?: number;
  tooltipDateLabel?: string;
  tooltipMetricLabel?: string;
}

export interface PasteurQuickMetric {
  label: string;
  value: string;
}

export type ProcessStatus = 'normal' | 'warning' | 'critical';
export type ProcessBinaryState = 'active' | 'inactive';
export type ProcessValveState = 'open' | 'closed';
export type ProcessTankTone = 'blue' | 'green';
export type ProcessMetricTone = 'neutral' | 'blue' | 'green' | 'orange' | 'red' | 'purple';

export interface ProcessMetric {
  label: string;
  value: string;
  tone?: ProcessMetricTone;
}

export interface ProcessTankData {
  title: string;
  label: string;
  value: string;
  level: number;
  tone: ProcessTankTone;
}

export interface ProcessPumpData {
  title: string;
  state: ProcessBinaryState;
  helper: string;
}

export interface PasteurizerUnitData {
  title: string;
  label: string;
  value: string;
  helper: string;
  status: ProcessStatus;
}

export interface ProcessValveData {
  title: string;
  state: ProcessValveState;
  label: string;
  value: string;
}

export interface BoilerUnitData {
  title: string;
  active: boolean;
  metrics: ProcessMetric[];
}

export interface ProcessSummaryData {
  title: string;
  metrics: ProcessMetric[];
  alarmText: string;
  hasAlarm: boolean;
}

export interface PasteurProcessDiagramData {
  inputTank: ProcessTankData;
  pump: ProcessPumpData;
  pasteurizer: PasteurizerUnitData;
  valve: ProcessValveData;
  outputTank: ProcessTankData;
  boiler: BoilerUnitData;
  summary: ProcessSummaryData;
}
