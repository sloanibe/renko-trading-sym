import React, { useState, useEffect } from 'react';
import ChartComponent from './ChartComponent';
import {
  RANGE_LONG_TAILS_SET,
  isProjectableSignalSet,
  projectRangeLongTails,
} from './projections/rangeLongTails';

const API_BASE = 'http://localhost:5000/api';
const ACTIVE_CHART_STORAGE_KEY = 'renko-active-chart';
const RAW_RANGE_MARKER_SET = 'Raw Range Bar Set';
const CAMPAIGN_OPTIONS = {
  mesReg5Recovery: {
    label: 'MES Reg5 Daily Recovery',
    resultKey: 'mes_reg5_daily_recovery_campaign_results',
    entryFlag: 'isMesReg5RecoveryCampaignEntry',
    exitFlag: 'isMesReg5RecoveryCampaignExit',
  },
  dailyTarget: {
    label: 'Daily Target Campaign',
    resultKey: 'campaign_results',
    entryFlag: 'isCampaignEntry',
    exitFlag: 'isCampaignExit',
  },
};
const VALID_CAMPAIGN_VIEWS = new Set(Object.keys(CAMPAIGN_OPTIONS));
const MES_REG5_CHARTS = ['MESM_reg_5', 'MES_8pt', 'MES_3pt'];
const defaultCampaignView = (savedView, chartName) => {
  if (MES_REG5_CHARTS.includes(chartName)) return 'mesReg5Recovery';
  if (VALID_CAMPAIGN_VIEWS.has(savedView)) return savedView;
  return 'dailyTarget';
};
const bookmarkStorageKey = chartName => `renko-bookmark:${chartName}`;
const MARKER_SETTINGS_STORAGE_KEY = 'renko-marker-settings';
const SIGNAL_SETS_STORAGE_KEY = 'renko-signal-sets';
const LAST_SIGNAL_SET_STORAGE_KEY = 'renko-last-signal-set';
const defaultMarkerSetForChart = chartName =>
  chartName?.includes('Range') || chartName === 'MES3' ? RAW_RANGE_MARKER_SET : 'Training Set';

const loadMarkerSettings = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(MARKER_SETTINGS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const loadCustomSignalSets = () => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SIGNAL_SETS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const loadLastSignalSets = () => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_SIGNAL_SET_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const metricsMatchBrick = (metrics, brick) => {
  if (!metrics || !brick) return false;
  return ['open', 'high', 'low', 'close', 'ema'].every(key => {
    if (!Number.isFinite(metrics[key]) || !Number.isFinite(brick[key])) return true;
    return Math.abs(metrics[key] - brick[key]) < 0.0001;
  });
};

const annotationMatchesBrick = (annotation, brick) => {
  if (!annotation || !brick) return false;
  if (Number.isInteger(annotation.barIndex) && Number.isInteger(brick.originalIndex)) {
    if (annotation.barIndex === brick.originalIndex) return true;
  }

  const targetTime = brick.originalTime || brick.time;
  if (annotation.timestamp !== targetTime) return false;
  if (!annotation.metrics) return true;
  return metricsMatchBrick(annotation.metrics, brick);
};

export default function App() {
  const savedMarkerSettings = React.useMemo(loadMarkerSettings, []);
  const [charts, setCharts] = useState([]);
  const [activeChart, setActiveChart] = useState('');
  const isRegularCandlestick = activeChart?.toLowerCase().includes('reg');
  const [chartData, setChartData] = useState([]);
  const [secondaryChartData, setSecondaryChartData] = useState([]);
  const [showSecondaryPane, setShowSecondaryPane] = useState(false);
  const [currentHaSelection, setCurrentHaSelection] = useState(null);
  const [allAnnotations, setAllAnnotations] = useState({});
  const [selectedBrick, setSelectedBrick] = useState(null);
  const [backtestResults, setBacktestResults] = useState(null);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [discussionStatus, setDiscussionStatus] = useState('');
  const [bookmark, setBookmark] = useState(null);
  const [annotationsDrawerOpen, setAnnotationsDrawerOpen] = useState(false);
  const [datasetsDrawerOpen, setDatasetsDrawerOpen] = useState(false);
  const [datasetContextMenu, setDatasetContextMenu] = useState(null);

  // Chart display controls
  const [customSignalSetsByChart, setCustomSignalSetsByChart] = useState(loadCustomSignalSets);
  const [lastSignalSetByChart, setLastSignalSetByChart] = useState(loadLastSignalSets);
  const [creatingSignalSet, setCreatingSignalSet] = useState(false);
  const [newSignalSetName, setNewSignalSetName] = useState('');
  const [projectingSignalSets, setProjectingSignalSets] = useState(
    savedMarkerSettings.projectingSignalSets || {}
  );
  const [activeProjection, setActiveProjection] = useState(null);
  const [campaignView, setCampaignView] = useState(
    defaultCampaignView(savedMarkerSettings.campaignView, localStorage.getItem(ACTIVE_CHART_STORAGE_KEY))
  );

  const fetchBacktest = async (chartName) => {
    if (!chartName) return;
    setLoadingBacktest(true);

    try {
      const res = await fetch(`${API_BASE}/charts/${chartName}/backtest`);
      const data = await res.json();
      setBacktestResults(data);
    } catch (err) {
      console.error('Failed to fetch backtest results:', err);
    } finally {
      setLoadingBacktest(false);
    }
  };
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedMarkerSet, setSelectedMarkerSet] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isCreatingNewSet, setIsCreatingNewSet] = useState(false);
  const [visibleMarkerSets, setVisibleMarkerSets] = useState(savedMarkerSettings.visibleMarkerSets || {});

  // Draggable Modal state
  const [modalPosition, setModalPosition] = useState({ x: 100, y: 100 });
  const [dragStart, setDragStart] = useState(null);



  const handleMouseDown = (e) => {
    // Only drag on the header, not on input fields, buttons, or textareas
    if (
      e.target.tagName === 'INPUT' || 
      e.target.tagName === 'TEXTAREA' || 
      e.target.tagName === 'BUTTON' || 
      e.target.closest('button')
    ) {
      return;
    }
    setDragStart({
      startX: e.clientX - modalPosition.x,
      startY: e.clientY - modalPosition.y,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragStart) return;
      const newX = e.clientX - dragStart.startX;
      const newY = e.clientY - dragStart.startY;
      
      // Keep modal within viewport boundaries
      const boundedX = Math.max(10, Math.min(window.innerWidth - 490, newX));
      const boundedY = Math.max(10, Math.min(window.innerHeight - 460, newY));
      
      setModalPosition({ x: boundedX, y: boundedY });
    };

    const handleMouseUp = () => {
      setDragStart(null);
    };

    if (dragStart) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragStart, modalPosition]);

  // Fetch available charts and annotations on mount
  useEffect(() => {
    fetchCharts();
    fetchAnnotations();
  }, []);

  useEffect(() => {
    if (activeChart) {
      localStorage.setItem(ACTIVE_CHART_STORAGE_KEY, activeChart);
    }
  }, [activeChart]);

  useEffect(() => {
    const nextView = defaultCampaignView(campaignView, activeChart);
    if (nextView !== campaignView) {
      setCampaignView(nextView);
    } else if (!VALID_CAMPAIGN_VIEWS.has(campaignView)) {
      setCampaignView('dailyTarget');
    }
  }, [activeChart, campaignView]);

  useEffect(() => {
    localStorage.setItem(MARKER_SETTINGS_STORAGE_KEY, JSON.stringify({
      campaignView,
      visibleMarkerSets,
      projectingSignalSets,
    }));
  }, [
    campaignView,
    visibleMarkerSets,
    projectingSignalSets,
  ]);

  const persistMarkerSettings = (patch) => {
    try {
      const saved = JSON.parse(localStorage.getItem(MARKER_SETTINGS_STORAGE_KEY) || '{}');
      localStorage.setItem(MARKER_SETTINGS_STORAGE_KEY, JSON.stringify({ ...saved, ...patch }));
    } catch {
      // ignore persistence errors
    }
  };

  const toggleProjectingSignalSet = (setName) => {
    setProjectingSignalSets(prev => {
      const next = { ...prev, [setName]: !prev[setName] };
      persistMarkerSettings({ projectingSignalSets: next });
      return next;
    });
  };

  useEffect(() => {
    localStorage.setItem(SIGNAL_SETS_STORAGE_KEY, JSON.stringify(customSignalSetsByChart));
  }, [customSignalSetsByChart]);

  useEffect(() => {
    localStorage.setItem(LAST_SIGNAL_SET_STORAGE_KEY, JSON.stringify(lastSignalSetByChart));
  }, [lastSignalSetByChart]);

  // Fetch chart data and backtest when active selection changes
  useEffect(() => {
    if (activeChart) {
      fetchChartData(activeChart);
      if (activeChart === 'MES3' || activeChart === 'MESM_reg_5') {
        fetchSecondaryChartData('MES_2sec_HA');
      } else {
        setSecondaryChartData([]);
        setCurrentHaSelection(null);
      }
      fetchBacktest(activeChart);
      const savedBookmark = localStorage.getItem(bookmarkStorageKey(activeChart));
      try {
        setBookmark(savedBookmark ? JSON.parse(savedBookmark) : null);
      } catch {
        setBookmark(null);
      }
    } else {
      setChartData([]);
      setSecondaryChartData([]);
      setCurrentHaSelection(null);
      setBacktestResults(null);
      setBookmark(null);
    }
  }, [activeChart]);

  const fetchCharts = async () => {
    try {
      const res = await fetch(`${API_BASE}/charts`);
      const data = await res.json();
      setCharts(data);
      if (data.length > 0 && !activeChart) {
        const savedChart = localStorage.getItem(ACTIVE_CHART_STORAGE_KEY);
        setActiveChart(savedChart && data.includes(savedChart) ? savedChart : data[0]);
      }
    } catch (err) {
      console.error('Failed to fetch charts:', err);
    }
  };

  const handleDatasetContextMenu = (event, chartName) => {
    event.preventDefault();
    event.stopPropagation();
    setDatasetContextMenu({
      chartName,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleDeleteDataset = async (chartName) => {
    setDatasetContextMenu(null);
    const annotationCount = (allAnnotations[chartName] || []).length;
    const confirmed = window.confirm(
      annotationCount > 0
        ? `Delete dataset "${chartName}" and its ${annotationCount} annotation${annotationCount === 1 ? '' : 's'}? This cannot be undone.`
        : `Delete dataset "${chartName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/charts/${encodeURIComponent(chartName)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        throw new Error(details.error || `Delete failed with status ${res.status}`);
      }

      const remaining = charts.filter(name => name !== chartName);
      setCharts(remaining);

      setAllAnnotations(prev => {
        if (!Object.prototype.hasOwnProperty.call(prev, chartName)) return prev;
        const next = { ...prev };
        delete next[chartName];
        return next;
      });

      if (activeChart === chartName) {
        const nextChart = remaining[0] || '';
        setActiveChart(nextChart);
        if (!nextChart) {
          setChartData([]);
          setSecondaryChartData([]);
          setBacktestResults(null);
          localStorage.removeItem(ACTIVE_CHART_STORAGE_KEY);
        }
      }

      localStorage.removeItem(bookmarkStorageKey(chartName));
    } catch (err) {
      console.error('Failed to delete dataset:', err);
      alert(`Failed to delete dataset: ${err.message}`);
    }
  };

  useEffect(() => {
    if (!datasetContextMenu) return undefined;

    const closeMenu = () => setDatasetContextMenu(null);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [datasetContextMenu]);

  const fetchAnnotations = async () => {
    try {
      const res = await fetch(`${API_BASE}/annotations`);
      const data = await res.json();
      setAllAnnotations(data);
    } catch (err) {
      console.error('Failed to fetch annotations:', err);
    }
  };

  const fetchChartData = async (name) => {
    try {
      const res = await fetch(`${API_BASE}/charts/${name}`);
      const data = await res.json();
      setChartData(data);
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    }
  };

  const fetchSecondaryChartData = async (name) => {
    try {
      const res = await fetch(`${API_BASE}/charts/${name}`);
      if (!res.ok) {
        setSecondaryChartData([]);
        return;
      }
      const data = await res.json();
      setSecondaryChartData(data);
    } catch (err) {
      console.error('Failed to fetch secondary chart data:', err);
      setSecondaryChartData([]);
    }
  };

  const handleHaSelectionChange = async (selection) => {
    setCurrentHaSelection(selection);
    try {
      await fetch(`${API_BASE}/ai-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'heiken_ashi_range',
          chart: activeChart,
          secondaryChart: 'MES_2sec_HA',
          selectedAt: new Date().toISOString(),
          selection,
        }),
      });
    } catch (err) {
      console.error('Failed to publish Heiken Ashi selection:', err);
    }
  };

  // Handle keyboard shortcuts when modal is open
  useEffect(() => {
    if (!modalOpen || !selectedBrick) return;

    const handleKeyDown = (e) => {
      // If user is typing in the textarea, only handle Enter (without Shift) to save
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSaveAnnotation();
        }
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'b' || e.key === '1') {
        setSelectedAction('Buy');
      } else if (key === 's' || e.key === '2') {
        setSelectedAction('Sell');
      } else if (key === 'k' || e.key === '3') {
        setSelectedAction('Skip');
      } else if (e.key === 'Enter') {
        handleSaveAnnotation();
      } else if (e.key === 'Escape') {
        setActiveProjection(null);
        setModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modalOpen, selectedAction, selectedMarkerSet, commentText, selectedBrick, activeChart]);

  const handleBrickClick = (brick, clickPoint) => {
    // Match the exact brick; imported Renko data can contain duplicate timestamps.
    const activeAnnotations = allAnnotations[activeChart] || [];
    const targetTime = brick.originalTime || brick.time;
    const existing = activeAnnotations.find(annotation => annotationMatchesBrick(annotation, brick));
    const barIndex = brick.originalIndex;
    const exactSystemSignal = backtestResults?.signal_details?.find(
      signal => signal.barIndex === barIndex
    );
    const systemSignal = exactSystemSignal?.action || null;

    if (Number.isInteger(barIndex)) {
      const contextStart = Math.max(0, barIndex - 12);
      const contextEnd = Math.min(chartData.length, barIndex + 13);
      const context = chartData.slice(contextStart, contextEnd).map((bar, offset) => ({
        barIndex: contextStart + offset,
        relativePosition: contextStart + offset - barIndex,
        ...bar,
      }));
      const previousBar = chartData[barIndex - 1];
      const emaThreeBarsAgo = chartData[barIndex - 3]?.ema;
      const isUpBrick = brick.close > brick.open;
      const wickLength = isUpBrick ? brick.open - brick.low : brick.high - brick.open;

      setDiscussionStatus('Publishing selected setup...');
      fetch(`${API_BASE}/ai-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chart: activeChart,
          selectedAt: new Date().toISOString(),
          selectedBar: {
            barIndex,
            timestamp: targetTime,
            direction: isUpBrick ? 'Up' : 'Down',
            systemSignal,
            annotation: existing || null,
            values: {
              open: brick.open,
              high: brick.high,
              low: brick.low,
              close: brick.close,
              ema: brick.ema,
            },
            measurements: {
              bodySize: Math.abs(brick.close - brick.open),
              wickLength,
              closeToEma: Number.isFinite(brick.ema) ? brick.close - brick.ema : null,
              emaSlopeThreeBars: Number.isFinite(emaThreeBarsAgo)
                ? brick.ema - emaThreeBarsAgo
                : null,
              previousOpen: previousBar?.open ?? null,
              wickReachesPreviousOpen: previousBar
                ? (isUpBrick ? brick.low <= previousBar.open : brick.high >= previousBar.open)
                : null,
            },
          },
          context,
        }),
      })
        .then(response => {
          if (!response.ok) throw new Error(`Selection server returned ${response.status}`);
          setDiscussionStatus('Ready. Tell Codex: analyze my selected setup.');
        })
        .catch(error => {
          console.error('Failed to publish selected setup:', error);
          setDiscussionStatus('Could not publish selection. Check the API server.');
        });
    }
    
    setSelectedBrick(brick);
    setIsCreatingNewSet(false);
    if (existing) {
      const existingSet = existing.markerSet || defaultMarkerSetForChart(activeChart);
      setSelectedAction(existing.action);
      setSelectedMarkerSet(existingSet);
      setCommentText(existing.comment || '');
      setIsEditing(true);
      setActiveProjection(null);
      if (existingSet) {
        setVisibleMarkerSets(prev => ({ ...prev, [existingSet]: true }));
      }
    } else {
      const projection = Number.isInteger(barIndex) ? projectionByBarIndex.get(barIndex) : null;
      if (projection) {
        setSelectedAction(projection.action);
        setSelectedMarkerSet(projection.markerSet || RANGE_LONG_TAILS_SET);
        setCommentText(projection.comment || '');
        setIsEditing(false);
        setActiveProjection(projection);
        setLastSignalSetByChart(prev => ({
          ...prev,
          [activeChart]: projection.markerSet || RANGE_LONG_TAILS_SET,
        }));
      } else {
        setActiveProjection(null);
        // Keep using the last signal set chosen for this chart (or current selection)
        const chartAnnotations = allAnnotations[activeChart] || [];
        const knownSets = new Set(customSignalSetsByChart[activeChart] || []);
        chartAnnotations.forEach(ann => {
          knownSets.add(ann.markerSet || defaultMarkerSetForChart(activeChart));
        });
        const preferred =
          lastSignalSetByChart[activeChart] ||
          selectedMarkerSet ||
          [...knownSets][0] ||
          '';
        const nextSet = knownSets.has(preferred) ? preferred : ([...knownSets][0] || '');
        setSelectedMarkerSet(nextSet);

        // Check if there is a system signal for this brick
        const sysSignal = backtestResults?.signal_details?.find(
          signal => signal.barIndex === brick.originalIndex
        )?.action;
        if (sysSignal) {
          setSelectedAction(sysSignal);
          setCommentText('Approving system signal');
        } else {
          // Auto-prepopulate: Buy for Up bars (close > open), Sell for Down-bars (close < open)
          const defaultAction = brick.close > brick.open ? 'Buy' : 'Sell';
          setSelectedAction(defaultAction);
          setCommentText('');
        }
      }
      setIsEditing(false);
    }

    if (clickPoint) {
      const modalWidth = 320;
      const modalHeight = 330;

      // Determine if click point is in the right half of the viewport
      const isRightHalf = clickPoint.x > window.innerWidth / 2;

      // Place the modal either to the left or right of the bar (with 35px gap)
      let x = isRightHalf ? (clickPoint.x - modalWidth - 35) : (clickPoint.x + 35);
      x = Math.max(10, Math.min(window.innerWidth - modalWidth - 10, x));

      // Center vertically around the clicked point
      let y = clickPoint.y - (modalHeight / 2);
      y = Math.max(10, Math.min(window.innerHeight - modalHeight - 10, y));

      setModalPosition({ x, y });
    } else {
      // Fallback: center in screen
      const width = 320;
      const height = 330;
      const x = Math.max(20, (window.innerWidth - width) / 2);
      const y = Math.max(20, (window.innerHeight - height) / 2);
      setModalPosition({ x, y });
    }

    setModalOpen(true);
  };

  const handleSaveAnnotation = async () => {
    if (!selectedAction) {
      alert('Please select an action (Buy, Sell, or Skip)');
      return;
    }

    const activeAnnotations = [...(allAnnotations[activeChart] || [])];
    const targetTime = selectedBrick.originalTime || selectedBrick.time;
    
    const newAnnotation = {
      timestamp: targetTime,
      barIndex: selectedBrick.originalIndex,
      action: selectedAction,
      markerSet: selectedMarkerSet || defaultMarkerSetForChart(activeChart),
      comment: commentText,
      metrics: {
        open: selectedBrick.open,
        high: selectedBrick.high,
        low: selectedBrick.low,
        close: selectedBrick.close,
        ema: selectedBrick.ema,
        ema5: selectedBrick.ema5,
        ema10: selectedBrick.ema10,
      }
    };

    const index = activeAnnotations.findIndex(annotation => annotationMatchesBrick(annotation, selectedBrick));
    if (index !== -1) {
      // Update existing
      activeAnnotations[index] = newAnnotation;
    } else {
      // Add new
      activeAnnotations.push(newAnnotation);
    }

    // Sort chronologically by timestamp
    activeAnnotations.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Optimistically update UI
    const updated = { ...allAnnotations, [activeChart]: activeAnnotations };
    setAllAnnotations(updated);
    const savedSetName = newAnnotation.markerSet;
    if (savedSetName) {
      setVisibleMarkerSets(prev => ({ ...prev, [savedSetName]: true }));
      setCustomSignalSetsByChart(prev => {
        const existing = prev[activeChart] || [];
        if (existing.includes(savedSetName)) return prev;
        return { ...prev, [activeChart]: [...existing, savedSetName] };
      });
      setLastSignalSetByChart(prev => ({ ...prev, [activeChart]: savedSetName }));
      setSelectedMarkerSet(savedSetName);
    }
    setActiveProjection(null);
    setModalOpen(false);

    // Persist to disk via Node Express server
    try {
      const response = await fetch(`${API_BASE}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: activeChart, annotations: activeAnnotations }),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || `Annotation server returned ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to save annotation:', err);
      setAllAnnotations(allAnnotations);
      alert('Failed to save annotation. Make sure the API server is running on port 5000.');
    }
  };

  const handleDeleteAnnotation = async () => {
    if (!selectedBrick) return;

    const activeAnnotations = (allAnnotations[activeChart] || []).filter(
      annotation => !annotationMatchesBrick(annotation, selectedBrick)
    );

    // Optimistically update UI
    const updated = { ...allAnnotations, [activeChart]: activeAnnotations };
    setAllAnnotations(updated);
    setActiveProjection(null);
    setModalOpen(false);

    try {
      const response = await fetch(`${API_BASE}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: activeChart, annotations: activeAnnotations }),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || `Annotation server returned ${response.status}`);
      }
    } catch (err) {
      console.error('Failed to delete annotation:', err);
      setAllAnnotations(allAnnotations);
      alert('Failed to delete annotation. Make sure the API server is running on port 5000.');
    }
  };

  const handleBookmarkBrick = (brick) => {
    if (!brick || !Number.isInteger(brick.originalIndex) || !activeChart) return;

    const nextBookmark = {
      barIndex: brick.originalIndex,
      timestamp: brick.originalTime || brick.time,
    };
    localStorage.setItem(bookmarkStorageKey(activeChart), JSON.stringify(nextBookmark));
    setBookmark(nextBookmark);
  };

  const handleSetBookmark = () => {
    handleBookmarkBrick(selectedBrick);
  };

  const handleClearBookmark = () => {
    if (!activeChart) return;
    localStorage.removeItem(bookmarkStorageKey(activeChart));
    setBookmark(null);
  };

  const savedAnnotations = allAnnotations[activeChart] || [];

  // Signal sets = labeled training sets for this chart (not algorithmic overlays).
  // Only list sets that exist in annotations or were explicitly created — do not
  // force-add the default name, or empty defaults like "Training Set (0)" cannot be deleted.
  const availableMarkerSets = React.useMemo(() => {
    const sets = new Set();
    (customSignalSetsByChart[activeChart] || []).forEach(name => {
      if (name) sets.add(name);
    });
    savedAnnotations.forEach(ann => {
      sets.add(ann.markerSet || defaultMarkerSetForChart(activeChart));
    });
    return [...sets].sort((a, b) => a.localeCompare(b));
  }, [savedAnnotations, customSignalSetsByChart, activeChart]);

  const persistAnnotationsForChart = async (chartName, annotations) => {
    const response = await fetch(`${API_BASE}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileKey: chartName, annotations }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || `Annotation server returned ${response.status}`);
    }
  };

  const handleCreateSignalSet = () => {
    const name = newSignalSetName.trim();
    if (!activeChart) return;
    if (!name) {
      alert('Enter a name for the new signal set.');
      return;
    }
    if (availableMarkerSets.some(set => set.toLowerCase() === name.toLowerCase())) {
      alert(`Signal set "${name}" already exists.`);
      return;
    }

    setCustomSignalSetsByChart(prev => ({
      ...prev,
      [activeChart]: [...(prev[activeChart] || []), name],
    }));
    setVisibleMarkerSets(prev => ({ ...prev, [name]: true }));
    setLastSignalSetByChart(prev => ({ ...prev, [activeChart]: name }));
    setSelectedMarkerSet(name);
    setIsCreatingNewSet(false);
    setNewSignalSetName('');
    setCreatingSignalSet(false);
  };

  const handleDeleteSignalSet = async (setName) => {
    if (!activeChart || !setName) return;
    const count = savedAnnotations.filter(
      ann => (ann.markerSet || defaultMarkerSetForChart(activeChart)) === setName
    ).length;
    const confirmed = window.confirm(
      count > 0
        ? `Delete signal set "${setName}" and its ${count} annotation${count === 1 ? '' : 's'}? This cannot be undone.`
        : `Delete empty signal set "${setName}"?`
    );
    if (!confirmed) return;

    const previousAnnotations = allAnnotations;
    const previousCustomSets = customSignalSetsByChart;
    const nextAnnotations = savedAnnotations.filter(
      ann => (ann.markerSet || defaultMarkerSetForChart(activeChart)) !== setName
    );
    const nextCustomSets = (customSignalSetsByChart[activeChart] || []).filter(name => name !== setName);

    setAllAnnotations(prev => ({ ...prev, [activeChart]: nextAnnotations }));
    setCustomSignalSetsByChart(prev => ({
      ...prev,
      [activeChart]: nextCustomSets,
    }));
    setVisibleMarkerSets(prev => {
      const next = { ...prev };
      delete next[setName];
      return next;
    });
    setProjectingSignalSets(prev => {
      if (!Object.prototype.hasOwnProperty.call(prev, setName)) return prev;
      const next = { ...prev };
      delete next[setName];
      persistMarkerSettings({ projectingSignalSets: next });
      return next;
    });

    const remainingSetNames = new Set(nextCustomSets);
    nextAnnotations.forEach(ann => {
      remainingSetNames.add(ann.markerSet || defaultMarkerSetForChart(activeChart));
    });
    const fallbackSet = [...remainingSetNames].sort((a, b) => a.localeCompare(b))[0] || '';
    if (selectedMarkerSet === setName || !remainingSetNames.has(selectedMarkerSet)) {
      setSelectedMarkerSet(fallbackSet);
      setIsCreatingNewSet(false);
    }

    try {
      await persistAnnotationsForChart(activeChart, nextAnnotations);
    } catch (err) {
      console.error('Failed to delete signal set:', err);
      setAllAnnotations(previousAnnotations);
      setCustomSignalSetsByChart(previousCustomSets);
      alert(`Failed to delete signal set: ${err.message}`);
    }
  };

  const handleClearSignalSet = async (setName) => {
    if (!activeChart || !setName) return;
    const count = savedAnnotations.filter(
      ann => (ann.markerSet || defaultMarkerSetForChart(activeChart)) === setName
    ).length;
    if (count === 0) return;

    const confirmed = window.confirm(
      `Clear all ${count} signal${count === 1 ? '' : 's'} from "${setName}"? The signal set will remain, but its saved markers will be removed.`
    );
    if (!confirmed) return;

    const previousAnnotations = allAnnotations;
    const nextAnnotations = savedAnnotations.filter(
      ann => (ann.markerSet || defaultMarkerSetForChart(activeChart)) !== setName
    );
    setAllAnnotations(prev => ({ ...prev, [activeChart]: nextAnnotations }));

    try {
      await persistAnnotationsForChart(activeChart, nextAnnotations);
    } catch (err) {
      console.error('Failed to clear signal set:', err);
      setAllAnnotations(previousAnnotations);
      alert(`Failed to clear signal set: ${err.message}`);
    }
  };

  // Construct annotations to pass to ChartComponent, including a temporary preview if the modal is open
  const currentAnnotations = React.useMemo(() => {
    if (!modalOpen || !selectedBrick) {
      return savedAnnotations;
    }

    const previewAnn = {
      timestamp: selectedBrick.originalTime || selectedBrick.time,
      barIndex: selectedBrick.originalIndex,
      action: selectedAction,
      markerSet: selectedMarkerSet || defaultMarkerSetForChart(activeChart),
      comment: commentText,
      metrics: {
        open: selectedBrick.open,
        high: selectedBrick.high,
        low: selectedBrick.low,
        close: selectedBrick.close,
        ema: selectedBrick.ema,
        ema5: selectedBrick.ema5,
        ema10: selectedBrick.ema10,
      },
      isPreview: true,
    };

    const exists = savedAnnotations.some(annotation => annotationMatchesBrick(annotation, selectedBrick));

    if (exists) {
      return savedAnnotations.map(annotation =>
        annotationMatchesBrick(annotation, selectedBrick) ? previewAnn : annotation
      );
    } else {
      return [...savedAnnotations, previewAnn];
    }
  }, [savedAnnotations, modalOpen, selectedBrick, selectedAction, selectedMarkerSet, commentText, activeChart]);

  // Filtered annotations based on visible signal sets (opt-in checkboxes)
  const filteredManualAnnotations = React.useMemo(() => {
    return currentAnnotations.filter(ann => {
      if (ann.isPreview) return true;
      const set = ann.markerSet || defaultMarkerSetForChart(activeChart);
      return visibleMarkerSets[set] === true;
    });
  }, [currentAnnotations, visibleMarkerSets, activeChart]);

  const projectedAnnotations = React.useMemo(() => {
    if (!chartData.length) return [];

    const projections = [];
    if (projectingSignalSets[RANGE_LONG_TAILS_SET]) {
      const labeledIndexes = new Set(
        (allAnnotations[activeChart] || [])
          .filter(ann => (ann.markerSet || '') === RANGE_LONG_TAILS_SET)
          .map(ann => ann.barIndex)
          .filter(Number.isInteger)
      );
      projections.push(
        ...projectRangeLongTails(chartData, { excludeBarIndexes: labeledIndexes })
      );
    }
    return projections;
  }, [chartData, projectingSignalSets, allAnnotations, activeChart]);

  const projectionByBarIndex = React.useMemo(() => {
    const map = new Map();
    projectedAnnotations.forEach(projection => {
      if (Number.isInteger(projection.barIndex)) {
        map.set(projection.barIndex, projection);
      }
    });
    return map;
  }, [projectedAnnotations]);

  // Training markers + optional AI projections for enabled signal sets
  const mergedAnnotations = React.useMemo(
    () => [...filteredManualAnnotations, ...projectedAnnotations],
    [filteredManualAnnotations, projectedAnnotations]
  );
  // Compute performance and alignment stats
  const stats = React.useMemo(() => {
    if (!backtestResults || !backtestResults.signal_evaluations) return null;
    
    const evaluations = backtestResults.signal_evaluations;
    const passed = evaluations.filter(item => item.result === 'Pass').length;
    const failed = evaluations.filter(item => item.result === 'Fail').length;
    const pending = evaluations.filter(item => item.result === 'Pending').length;
    const resolved = passed + failed;
    const passRate = resolved > 0 ? (passed / resolved * 100).toFixed(1) : '0.0';
    
    const alignment = backtestResults.alignment || {};
    const matches = alignment.matches_count || 0;
    const missed = alignment.false_negatives_count || 0;
    const overTriggers = alignment.false_positives_count || 0;
    const totalLabeled = matches + missed;
    const alignmentRate = totalLabeled > 0 ? (matches / totalLabeled * 100).toFixed(1) : '0.0';
    
    const campaign = backtestResults.campaign_results || {};
    const campaignSummary = campaign.summary || {};
    const selectedCampaign = CAMPAIGN_OPTIONS[campaignView] || CAMPAIGN_OPTIONS.dailyTarget;
    const selectedCampaignResults = backtestResults[selectedCampaign.resultKey] || {};
    const selectedCampaignSummary = selectedCampaignResults.summary || {};
    const selectedCampaignRules = selectedCampaignResults.rules || {};

    return {
      totalSignals: evaluations.length,
      passed,
      failed,
      pending,
      passRate,
      matches,
      missed,
      overTriggers,
      alignmentRate,
      totalLabeled,
      campaignTotalDays: campaignSummary.total_days || 0,
      campaignWinningDays: campaignSummary.winning_days || 0,
      campaignLosingDays: campaignSummary.losing_days || 0,
      campaignWinRate: campaignSummary.win_rate !== undefined ? campaignSummary.win_rate.toFixed(1) : '0.0',
      campaignAvgTime: campaignSummary.avg_success_time || 'N/A',
      campaignMaxDrawdown: campaignSummary.max_drawdown_bricks !== undefined ? campaignSummary.max_drawdown_bricks.toFixed(1) : '0.0',
      selectedCampaignName: selectedCampaignResults.name || selectedCampaign.label,
      selectedCampaignTrades: selectedCampaignSummary.total_trades || 0,
      selectedCampaignWinningTrades: selectedCampaignSummary.winning_trades || 0,
      selectedCampaignLosingTrades: selectedCampaignSummary.losing_trades || 0,
      selectedCampaignTradeWinRate: selectedCampaignSummary.trade_win_rate !== undefined ? selectedCampaignSummary.trade_win_rate.toFixed(1) : '0.0',
      selectedCampaignNet: selectedCampaignSummary.net_profit_bricks !== undefined ? selectedCampaignSummary.net_profit_bricks.toFixed(1) : '0.0',
      selectedCampaignMaxDrawdown: selectedCampaignSummary.max_drawdown_bricks !== undefined ? selectedCampaignSummary.max_drawdown_bricks.toFixed(1) : '0.0',
      selectedCampaignExit: selectedCampaignRules.exit || selectedCampaignRules.target || 'N/A',
    };
  }, [backtestResults, campaignView]);

  return (
    <div className="app-container">
      <button
        type="button"
        className="datasets-drawer-button"
        onClick={() => setDatasetsDrawerOpen(true)}
      >
        Datasets
      </button>

      {datasetsDrawerOpen && (
        <div className="datasets-drawer-backdrop" onClick={() => setDatasetsDrawerOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`app-sidebar ${datasetsDrawerOpen ? 'open' : ''}`}>
        <div>
          <div className="drawer-panel-header">
            <h3 className="section-title" style={{ margin: 0 }}>Datasets</h3>
            <button
              type="button"
              className="drawer-close-button"
              onClick={() => setDatasetsDrawerOpen(false)}
            >
              Close
            </button>
          </div>
          {charts.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
              No charts imported yet.<br/>Export from MultiCharts to get started.
            </div>
          ) : (
            <div className="file-list">
              {charts.map(c => (
                <div
                  key={c}
                  className={`file-item ${activeChart === c ? 'active' : ''}`}
                  onClick={() => {
                    setActiveChart(c);
                    setDatasetsDrawerOpen(false);
                    setDatasetContextMenu(null);
                  }}
                  onContextMenu={(event) => handleDatasetContextMenu(event, c)}
                  title="Left-click to open · Right-click for options"
                >
                  <span className="file-name">{c}</span>
                  <span className="file-meta">
                    {(allAnnotations[c] || []).length} annotations
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {datasetContextMenu && (
          <div
            className="dataset-context-menu"
            style={{ top: datasetContextMenu.y, left: datasetContextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="dataset-context-menu-item danger"
              onClick={() => handleDeleteDataset(datasetContextMenu.chartName)}
            >
              Delete dataset…
            </button>
          </div>
        )}

        {/* Dynamic Help Widget */}
        <div className="upload-zone">
          <div className="upload-icon">⚡</div>
          <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>AI-Driven Ingestion</h4>
          <p className="upload-text" style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            Export data in MultiCharts to:<br/>
            <code>C:\MultiChartsExports\</code><br/>
            Then ask Antigravity in the chat:<br/>
            <strong style={{ color: 'var(--primary)', display: 'block', marginTop: '4px' }}>
              "Import export.json as MNQ_15pt"
            </strong>
          </p>
        </div>

        {/* Strategy & Alignment Card */}
        {chartData.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Signal Sets */}
            <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                <h4 style={{ color: 'var(--primary)', margin: 0, fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🏷️</span> Signal Sets
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingSignalSet(true);
                    setNewSignalSetName('');
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--primary)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  + New
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.4 }}>
                  Your labeled training sets. Check a set to show its Buy/Sell/Skip markers on the chart.
                </p>

                {creatingSignalSet && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={newSignalSetName}
                      onChange={(e) => setNewSignalSetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateSignalSet();
                        } else if (e.key === 'Escape') {
                          setCreatingSignalSet(false);
                          setNewSignalSetName('');
                        }
                      }}
                      placeholder="New signal set name"
                      autoFocus
                      style={{
                        flex: 1,
                        height: '30px',
                        padding: '0 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '12px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateSignalSet}
                      style={{
                        height: '30px',
                        padding: '0 10px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'var(--primary)',
                        color: '#041018',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                      }}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingSignalSet(false);
                        setNewSignalSetName('');
                      }}
                      style={{
                        height: '30px',
                        padding: '0 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {availableMarkerSets.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      No signal sets yet. Create one to start labeling.
                    </div>
                  ) : (
                    availableMarkerSets.map(set => {
                      const count = savedAnnotations.filter(
                        ann => (ann.markerSet || defaultMarkerSetForChart(activeChart)) === set
                      ).length;
                      const isChecked = visibleMarkerSets[set] === true;
                      const canProject = isProjectableSignalSet(set);
                      const isProjecting = projectingSignalSets[set] === true;
                      const projectionCount = canProject && isProjecting
                        ? projectedAnnotations.filter(p => p.markerSet === set).length
                        : 0;
                      return (
                        <div key={set} className="signal-set-row">
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: '500', userSelect: 'none', flex: 1, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => setVisibleMarkerSets(prev => ({ ...prev, [set]: !isChecked }))}
                              style={{ accentColor: '#22c55e', cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {set} ({count})
                            </span>
                          </label>
                          {canProject && (
                            <label
                              title="Show AI-projected Buy/Sell markers inferred from this training set"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: isProjecting ? '#22d3ee' : 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', fontWeight: '600', userSelect: 'none', flexShrink: 0 }}
                            >
                              <input
                                type="checkbox"
                                checked={isProjecting}
                                onChange={() => toggleProjectingSignalSet(set)}
                                style={{ accentColor: '#22d3ee', cursor: 'pointer', width: '14px', height: '14px' }}
                              />
                              Project{isProjecting ? ` (${projectionCount})` : ''}
                            </label>
                          )}
                          <button
                            type="button"
                            title={`Clear ${count} signal${count === 1 ? '' : 's'} from ${set}`}
                            disabled={count === 0}
                            onClick={() => handleClearSignalSet(set)}
                            style={{
                              border: '1px solid var(--border-color)',
                              background: 'transparent',
                              color: count > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                              cursor: count > 0 ? 'pointer' : 'not-allowed',
                              fontSize: '11px',
                              padding: '3px 6px',
                              borderRadius: '4px',
                              flexShrink: 0,
                            }}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            title={`Delete ${set}`}
                            onClick={() => handleDeleteSignalSet(set)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: 'var(--color-sell, #ff5c7a)',
                              cursor: 'pointer',
                              fontSize: '11px',
                              padding: '4px 6px',
                              borderRadius: '4px',
                              flexShrink: 0,
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Active Dataset Stats */}
            <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <h4 style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>📊</span> Dataset Stats
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Bricks:</span>
                  <span style={{ fontWeight: '600' }}>{chartData.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>User Annotations:</span>
                  <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{savedAnnotations.length}</span>
                </div>
              </div>
            </div>

            {/* Backtest & Alignment Stats */}
            {loadingBacktest ? (
              <div style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Running backtester engine...
              </div>
            ) : stats ? (
              <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <h4 style={{ color: '#10b981', marginBottom: '8px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚙️</span> Signal Quality
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Total Signals:</span>
                      <span style={{ fontWeight: '600' }}>{stats.totalSignals}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Passed / Failed:</span>
                      <span style={{ fontWeight: '600' }}>{stats.passed}P - {stats.failed}F</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Pass Rate:</span>
                      <span style={{ fontWeight: '600', color: parseFloat(stats.passRate) >= 50 ? '#10b981' : '#ef4444' }}>{stats.passRate}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Pending:</span>
                      <span style={{ fontWeight: '600' }}>{stats.pending}</span>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <h4 style={{ color: '#3b82f6', marginBottom: '8px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>👁️</span> Eye vs. Algorithm
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Match Rate:</span>
                      <span style={{ fontWeight: '600', color: '#3b82f6' }}>{stats.alignmentRate}% ({stats.matches}/{stats.totalLabeled})</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Missed (FN):</span>
                      <span style={{ fontWeight: '600', color: stats.missed > 0 ? '#ff9100' : 'var(--text-secondary)' }}>{stats.missed}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Over-Triggers (FP):</span>
                      <span style={{ fontWeight: '600', color: stats.overTriggers > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{stats.overTriggers}</span>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <h4 style={{ color: '#a855f7', marginBottom: '8px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🎯</span> Session Campaign (Opt. B)
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Trading Days:</span>
                      <span style={{ fontWeight: '600' }}>{stats.campaignTotalDays} days</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Winning Days (+{backtestResults?.campaign_results?.summary?.target_bricks || 2.0}):</span>
                      <span style={{ fontWeight: '600', color: '#10b981' }}>{stats.campaignWinningDays} ({stats.campaignWinRate}%)</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Losing/Flat Days:</span>
                      <span style={{ fontWeight: '600', color: stats.campaignLosingDays > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{stats.campaignLosingDays}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Avg Time to Success:</span>
                      <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{stats.campaignAvgTime}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Max Drawdown:</span>
                      <span style={{ fontWeight: '600', color: parseFloat(stats.campaignMaxDrawdown) < 0 ? '#ef4444' : 'var(--text-secondary)' }}>{stats.campaignMaxDrawdown} bricks</span>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  <h4 style={{ color: campaignView === 'mesReg5Recovery' ? '#10b981' : 'var(--primary)', marginBottom: '8px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>↗</span> {stats.selectedCampaignName}
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Selected View:</span>
                      <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{CAMPAIGN_OPTIONS[campaignView]?.label || 'Daily Target Campaign'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Exit:</span>
                      <span style={{ fontWeight: '600', color: 'var(--text-main)', textAlign: 'right' }}>{stats.selectedCampaignExit}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Trades:</span>
                      <span style={{ fontWeight: '600' }}>{stats.selectedCampaignTrades}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Wins / Losses:</span>
                      <span style={{ fontWeight: '600' }}>{stats.selectedCampaignWinningTrades}W - {stats.selectedCampaignLosingTrades}L</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Trade Win Rate:</span>
                      <span style={{ fontWeight: '600', color: parseFloat(stats.selectedCampaignTradeWinRate) >= 40 ? '#10b981' : '#ef4444' }}>{stats.selectedCampaignTradeWinRate}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Net:</span>
                      <span style={{ fontWeight: '600', color: parseFloat(stats.selectedCampaignNet) >= 0 ? '#10b981' : '#ef4444' }}>{stats.selectedCampaignNet} ranges</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Max Drawdown:</span>
                      <span style={{ fontWeight: '600', color: parseFloat(stats.selectedCampaignMaxDrawdown) < 0 ? '#ef4444' : 'var(--text-secondary)' }}>{stats.selectedCampaignMaxDrawdown} ranges</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No backtest results available.
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Workspace */}
      <main className="main-workspace">
        {/* Chart View */}
        <div className="chart-container">
          {chartData.length > 0 ? (
            <>
              <div className="floating-info">
                <h4>{activeChart}</h4>
                <div className="inline-status">
                  <span className="status-dot"></span>
                  <span>Local Engine Active</span>
                </div>
                <div>{isRegularCandlestick ? 'Bars' : 'Bricks'}: {chartData.length}</div>
                {(activeChart === 'MES3' || activeChart === 'MESM_reg_5') && secondaryChartData.length > 0 && (
                  <div>HA 2s Bars: {secondaryChartData.length}</div>
                )}
                {currentHaSelection && (
                  <div style={{ color: 'var(--primary)' }}>
                    HA Selected: {currentHaSelection.barCount} bars · {currentHaSelection.linkedMesBarCount} MES
                  </div>
                )}
                <div style={{ color: 'var(--text-secondary)' }}>
                  Click on any {isRegularCandlestick ? 'candlestick' : 'Renko brick'} body or wick to add/edit annotations.
                </div>
              </div>
              <button
                type="button"
                className="annotations-drawer-button"
                onClick={() => setAnnotationsDrawerOpen(true)}
              >
                Annotations ({currentAnnotations.length})
              </button>
              <ChartComponent
                data={chartData}
                secondaryData={(activeChart === 'MES3' || activeChart === 'MESM_reg_5') ? secondaryChartData : []}
                annotations={mergedAnnotations}
                onBrickClick={handleBrickClick}
                onHaSelectionChange={handleHaSelectionChange}
                bookmark={bookmark}
                onSetBookmark={handleBookmarkBrick}
                onClearBookmark={handleClearBookmark}
                isRegularCandlestick={isRegularCandlestick}
                showSecondaryPane={showSecondaryPane}
                onToggleSecondaryPane={setShowSecondaryPane}
              />
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '12px', color: '#1e293b' }}>
              <span style={{ fontSize: '48px' }}>📈</span>
              <span style={{ fontWeight: '600', fontSize: '16px' }}>No Dataset Loaded</span>
              <span style={{ fontSize: '13px' }}>Export data from MultiCharts and import it to view the interactive chart.</span>
            </div>
          )}
        </div>

      </main>

      {annotationsDrawerOpen && (
        <div className="annotations-drawer-backdrop" onClick={() => setAnnotationsDrawerOpen(false)}>
          <aside className="annotations-drawer" onClick={event => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <h3 className="section-title" style={{ margin: 0 }}>Annotations Log</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Total Marked: {filteredManualAnnotations.length}
                </span>
              </div>
              <button
                type="button"
                className="drawer-close-button"
                onClick={() => setAnnotationsDrawerOpen(false)}
              >
                Close
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredManualAnnotations.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No visible annotations. Make sure their marker set is enabled in the sidebar.
                </div>
              ) : (
                <table className="annotations-table">
                  <thead>
                    <tr>
                      <th>Timestamp (ISO)</th>
                      <th>Set</th>
                      <th>Action</th>
                      <th>Open</th>
                      <th>High</th>
                      <th>Low</th>
                      <th>Close</th>
                      <th>EMA</th>
                      <th>Comments / Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredManualAnnotations.map((ann, i) => (
                      <tr
                        key={i}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          const indexedBrick = Number.isInteger(ann.barIndex) ? chartData[ann.barIndex] : null;
                          const brick = indexedBrick || chartData.find(d =>
                            d.time === ann.timestamp && metricsMatchBrick(ann.metrics, d)
                          );
                          if (brick) {
                            setAnnotationsDrawerOpen(false);
                            handleBrickClick({
                              ...brick,
                              originalTime: brick.time,
                              originalIndex: ann.barIndex ?? chartData.indexOf(brick),
                            });
                          }
                        }}
                      >
                        <td style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {ann.timestamp}
                        </td>
                        <td>
                          <span className="badge marker-set">
                            {ann.markerSet || defaultMarkerSetForChart(activeChart)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${ann.action.toLowerCase()}`}>
                            {ann.action.toUpperCase()}
                          </span>
                        </td>
                        <td>{ann.metrics?.open?.toFixed(2)}</td>
                        <td>{ann.metrics?.high?.toFixed(2)}</td>
                        <td>{ann.metrics?.low?.toFixed(2)}</td>
                        <td>{ann.metrics?.close?.toFixed(2)}</td>
                        <td>{ann.metrics?.ema?.toFixed(4)}</td>
                        <td style={{ color: 'var(--text-secondary)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ann.comment}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Annotation Modal Popup (Modeless & Draggable) */}
      {modalOpen && selectedBrick && (
        <div className="modal-non-blocking-container" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, pointerEvents: 'none' }}>
          <div 
            className="modal-content" 
            style={{ 
              position: 'fixed', 
              left: `${modalPosition.x}px`, 
              top: `${modalPosition.y}px`, 
              pointerEvents: 'auto',
              margin: 0
            }}
          >
            <div 
              className="modal-header" 
              onMouseDown={handleMouseDown} 
              style={{ 
                cursor: 'move', 
                userSelect: 'none', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                borderBottom: '1px solid var(--border-color)', 
                paddingBottom: '12px', 
                marginBottom: '4px' 
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', cursor: 'move', userSelect: 'none' }}>⋮⋮</span>
                <span className="modal-title" style={{ margin: 0 }}>
                  {isEditing ? 'Edit Annotation' : 'Add Trade Annotation'}
                </span>
              </div>
              <button 
                onClick={() => {
                  setActiveProjection(null);
                  setModalOpen(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onMouseOver={(e) => e.currentTarget.style.color = 'var(--color-sell)'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                ✕
              </button>
            </div>
            
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              MultiCharts timestamp:{' '}
              <span style={{ fontFamily: 'monospace' }}>
                {selectedBrick.originalTime || selectedBrick.time}
              </span>
            </div>
            {activeProjection && !isEditing && (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-main)',
                  background: 'rgba(34, 211, 238, 0.08)',
                  border: '1px solid rgba(34, 211, 238, 0.4)',
                  borderRadius: '6px',
                  padding: '8px 9px',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '2px', color: '#22d3ee' }}>
                  AI projection ({activeProjection.projectionRule}) — confirm, change, or Skip
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  Suggested {activeProjection.action}. Save to add it to the signal set, or Skip to mark a false positive.
                </div>
              </div>
            )}
            {isEditing && (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-main)',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.35)',
                  borderRadius: '6px',
                  padding: '8px 9px',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '2px', color: '#22c55e' }}>
                  Existing annotation loaded — edit and Update to save changes
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {(selectedMarkerSet || defaultMarkerSetForChart(activeChart)) + ' · ' + (selectedAction || 'Unlabeled')}
                  {commentText ? ` — ${commentText}` : ''}
                </div>
              </div>
            )}
            <div
              style={{
                fontSize: '11px',
                color: discussionStatus.startsWith('Could not') ? 'var(--color-sell)' : 'var(--primary)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '7px 9px',
              }}
            >
              AI discussion: {discussionStatus || 'Select a brick to publish its context.'}
            </div>

            <div className="bar-stats-grid">
              <div className="stat-item">
                <span className="stat-label">Open</span>
                <span className="stat-value">{selectedBrick.open.toFixed(2)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">High</span>
                <span className="stat-value">{selectedBrick.high.toFixed(2)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Low</span>
                <span className="stat-value">{selectedBrick.low.toFixed(2)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Close</span>
                <span className="stat-value">{selectedBrick.close.toFixed(2)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">{activeChart?.includes('8pt') || activeChart?.includes('3pt') ? '9 EMA' : '5 EMA'}</span>
                <span className="stat-value" style={{ color: 'var(--primary)' }}>
                  {(selectedBrick.ema5 ?? selectedBrick.ema) ? (selectedBrick.ema5 ?? selectedBrick.ema).toFixed(4) : 'N/A'}
                </span>
              </div>
              {selectedBrick.ema10 !== undefined && selectedBrick.ema10 !== null && (
                <div className="stat-item">
                  <span className="stat-label">10 EMA</span>
                  <span className="stat-value" style={{ color: '#008000' }}>
                    {selectedBrick.ema10.toFixed(4)}
                  </span>
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: '500', marginBottom: '6px' }}>Signal Set:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <select
                  className="marker-set-select"
                  value={isCreatingNewSet ? '__NEW_SET__' : (selectedMarkerSet || defaultMarkerSetForChart(activeChart))}
                  onChange={e => {
                    if (e.target.value === '__NEW_SET__') {
                      setIsCreatingNewSet(true);
                      setSelectedMarkerSet('');
                    } else {
                      setIsCreatingNewSet(false);
                      setSelectedMarkerSet(e.target.value);
                      if (activeChart && e.target.value) {
                        setLastSignalSetByChart(prev => ({ ...prev, [activeChart]: e.target.value }));
                      }
                    }
                  }}
                >
                  {availableMarkerSets.map(set => (
                    <option key={set} value={set}>{set}</option>
                  ))}
                  <option value="__NEW_SET__">+ Create new set...</option>
                </select>
                {isCreatingNewSet && (
                  <input
                    type="text"
                    className="marker-set-input"
                    placeholder="Enter new set name..."
                    value={selectedMarkerSet}
                    onChange={e => setSelectedMarkerSet(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: '500', marginBottom: '6px' }}>Label Action:</div>
              <div className="action-buttons">
                <button
                  className={`action-btn buy ${selectedAction === 'Buy' ? 'selected' : ''}`}
                  onClick={() => setSelectedAction('Buy')}
                >
                  BUY
                </button>
                <button
                  className={`action-btn sell ${selectedAction === 'Sell' ? 'selected' : ''}`}
                  onClick={() => setSelectedAction('Sell')}
                >
                  SELL
                </button>
                <button
                  className={`action-btn skip ${selectedAction === 'Skip' ? 'selected' : ''}`}
                  onClick={() => setSelectedAction('Skip')}
                >
                  SKIP / FALSE
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: '500', marginBottom: '6px' }}>Notes (e.g., wick size, EMA slope):</div>
              <textarea
                className="comment-input"
                placeholder="Enter trading context here..."
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              {isEditing && (
                <button
                  className="btn btn-delete"
                  style={{ marginRight: 'auto' }}
                  onClick={handleDeleteAnnotation}
                >
                  Delete
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={handleSetBookmark}
              >
                {bookmark?.barIndex === selectedBrick.originalIndex ? 'Bookmarked' : 'Bookmark This Bar'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setActiveProjection(null);
                  setModalOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveAnnotation}
              >
                {isEditing ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
