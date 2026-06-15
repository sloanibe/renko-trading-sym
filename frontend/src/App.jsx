import React, { useState, useEffect } from 'react';
import ChartComponent from './ChartComponent';

const API_BASE = 'http://localhost:5000/api';
const bookmarkStorageKey = chartName => `renko-bookmark:${chartName}`;

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
    return annotation.barIndex === brick.originalIndex;
  }

  const targetTime = brick.originalTime || brick.time;
  return annotation.timestamp === targetTime && metricsMatchBrick(annotation.metrics, brick);
};

export default function App() {
  const [charts, setCharts] = useState([]);
  const [activeChart, setActiveChart] = useState('');
  const [chartData, setChartData] = useState([]);
  const [allAnnotations, setAllAnnotations] = useState({});
  const [selectedBrick, setSelectedBrick] = useState(null);
  const [backtestResults, setBacktestResults] = useState(null);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [discussionStatus, setDiscussionStatus] = useState('');
  const [bookmark, setBookmark] = useState(null);

  // Strategy Configuration states
  const [slopeThreshold, setSlopeThreshold] = useState(2.0);
  const [minWick, setMinWick] = useState(5.0);
  const [maxEmaDist, setMaxEmaDist] = useState(20.0);
  const [retestTolerance, setRetestTolerance] = useState(2.0);
  const [ema24Slope, setEma24Slope] = useState(0.25);
  const [optimizing, setOptimizing] = useState(false);

  const fetchBacktest = async (chartName, configOverrides = {}) => {
    if (!chartName) return;
    setLoadingBacktest(true);
    
    // Prioritize overrides (passed during optimization/updates) over stale states
    const slope = configOverrides.slopeThreshold !== undefined ? configOverrides.slopeThreshold : slopeThreshold;
    const wick = configOverrides.minWick !== undefined ? configOverrides.minWick : minWick;
    const dist = configOverrides.maxEmaDist !== undefined ? configOverrides.maxEmaDist : maxEmaDist;
    const tol = configOverrides.retestTolerance !== undefined ? configOverrides.retestTolerance : retestTolerance;
    const ema24Val = configOverrides.ema24Slope !== undefined ? configOverrides.ema24Slope : ema24Slope;

    try {
      const query = `?slopeThreshold=${slope}&minWick=${wick}&maxEmaDist=${dist}&retestTolerance=${tol}&ema24Slope=${ema24Val}`;
      const res = await fetch(`${API_BASE}/charts/${chartName}/backtest${query}`);
      const data = await res.json();
      setBacktestResults(data);
    } catch (err) {
      console.error('Failed to fetch backtest results:', err);
    } finally {
      setLoadingBacktest(false);
    }
  };

  const handleOptimize = async () => {
    if (!activeChart) return;
    setOptimizing(true);
    try {
      const res = await fetch(`${API_BASE}/charts/${activeChart}/optimize`);
      const bestConfig = await res.json();
      if (bestConfig && !bestConfig.error) {
        setSlopeThreshold(bestConfig.ema_slope_threshold);
        setMinWick(bestConfig.min_wick_length);
        setMaxEmaDist(bestConfig.max_ema_distance);
        setRetestTolerance(bestConfig.wick_retest_tolerance);
        
        // Fetch backtest with the optimized config overrides immediately
        fetchBacktest(activeChart, {
          slopeThreshold: bestConfig.ema_slope_threshold,
          minWick: bestConfig.min_wick_length,
          maxEmaDist: bestConfig.max_ema_distance,
          retestTolerance: bestConfig.wick_retest_tolerance
        });
      } else {
        alert('Optimization failed: ' + (bestConfig.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to optimize parameters:', err);
      alert('Failed to connect to the optimization engine.');
    } finally {
      setOptimizing(false);
    }
  };
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isEditing, setIsEditing] = useState(false);

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

  // Fetch chart data and backtest when active selection changes or when configuration is adjusted
  useEffect(() => {
    if (activeChart) {
      fetchChartData(activeChart);
      fetchBacktest(activeChart);
      const savedBookmark = localStorage.getItem(bookmarkStorageKey(activeChart));
      try {
        setBookmark(savedBookmark ? JSON.parse(savedBookmark) : null);
      } catch {
        setBookmark(null);
      }
    } else {
      setChartData([]);
      setBacktestResults(null);
      setBookmark(null);
    }
  }, [activeChart, slopeThreshold, minWick, maxEmaDist, retestTolerance, ema24Slope]);

  const fetchCharts = async () => {
    try {
      const res = await fetch(`${API_BASE}/charts`);
      const data = await res.json();
      setCharts(data);
      if (data.length > 0 && !activeChart) {
        setActiveChart(data[0]);
      }
    } catch (err) {
      console.error('Failed to fetch charts:', err);
    }
  };

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
        setModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modalOpen, selectedAction, commentText, selectedBrick, activeChart]);

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
    if (existing) {
      setSelectedAction(existing.action);
      setCommentText(existing.comment || '');
      setIsEditing(true);
    } else {
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
      setIsEditing(false);
    }

    if (clickPoint) {
      const modalWidth = 320;
      const modalHeight = 310;

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
      const height = 310;
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
      comment: commentText,
      metrics: {
        open: selectedBrick.open,
        high: selectedBrick.high,
        low: selectedBrick.low,
        close: selectedBrick.close,
        ema: selectedBrick.ema,
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

  // Construct annotations to pass to ChartComponent, including a temporary preview if the modal is open
  const currentAnnotations = React.useMemo(() => {
    if (!modalOpen || !selectedBrick) {
      return savedAnnotations;
    }

    const previewAnn = {
      timestamp: selectedBrick.originalTime || selectedBrick.time,
      barIndex: selectedBrick.originalIndex,
      action: selectedAction,
      comment: commentText,
      metrics: {
        open: selectedBrick.open,
        high: selectedBrick.high,
        low: selectedBrick.low,
        close: selectedBrick.close,
        ema: selectedBrick.ema,
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
  }, [savedAnnotations, modalOpen, selectedBrick, selectedAction, commentText]);

  // Merge system signals with user annotations for chart display
  const mergedAnnotations = React.useMemo(() => {
    const merged = [...currentAnnotations];
    if (backtestResults?.signal_details) {
      backtestResults.signal_details.forEach(({ barIndex, timestamp, action }) => {
        const evaluation = backtestResults.signal_evaluations?.find(
          ev => ev.barIndex === barIndex && ev.direction === action
        );
        merged.push({
          timestamp,
          barIndex,
          action,
          isSystem: true,
          comment: 'System generated entry',
          evaluationResult: evaluation ? evaluation.result : 'Pending',
        });
      });
    }
    return merged;
  }, [currentAnnotations, backtestResults]);

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
      totalLabeled
    };
  }, [backtestResults]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">R</div>
          <div className="brand-title">Renko Strategy Explorer</div>
        </div>
        <div className="system-status">
          <div className="status-dot"></div>
          <span>Local Engine Active</span>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="app-sidebar">
        <div>
          <h3 className="section-title">Datasets</h3>
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
                  onClick={() => setActiveChart(c)}
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
            {/* Strategy Configuration Card */}
            <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px' }}>
              <h4 style={{ color: 'var(--primary)', marginBottom: '10px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>⚙️</span> Strategy Config</span>
                <button 
                  onClick={handleOptimize} 
                  disabled={optimizing}
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '10px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)',
                    transition: 'all 0.2s',
                    opacity: optimizing ? 0.7 : 1
                  }}
                  onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                  onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1.0)'}
                >
                  {optimizing ? 'Optimizing...' : 'Auto-Optimize ⚡'}
                </button>
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Min Wick Length */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Min Wick Length:</span>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{minWick.toFixed(1)} pt</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="40" 
                    step="0.5" 
                    value={minWick} 
                    onChange={(e) => setMinWick(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--primary)', height: '4px', borderRadius: '2px', outline: 'none' }}
                  />
                </div>

                {/* Max EMA Distance */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Max EMA Distance:</span>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{maxEmaDist.toFixed(1)} pt</span>
                  </div>
                  <input 
                    type="range" 
                    min="5" 
                    max="100" 
                    step="1" 
                    value={maxEmaDist} 
                    onChange={(e) => setMaxEmaDist(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--primary)', height: '4px', borderRadius: '2px', outline: 'none' }}
                  />
                </div>

                {/* EMA Slope Threshold */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>EMA Slope Threshold:</span>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{slopeThreshold.toFixed(1)} pt</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="50" 
                    step="0.5" 
                    value={slopeThreshold} 
                    onChange={(e) => setSlopeThreshold(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--primary)', height: '4px', borderRadius: '2px', outline: 'none' }}
                  />
                </div>

                {/* Wick Retest Tolerance */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Retest Tolerance:</span>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{retestTolerance.toFixed(1)} pt</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="30" 
                    step="0.5" 
                    value={retestTolerance} 
                    onChange={(e) => setRetestTolerance(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--primary)', height: '4px', borderRadius: '2px', outline: 'none' }}
                  />
                </div>

                {/* 24 EMA Slope Threshold */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>24 EMA Slope:</span>
                    <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{ema24Slope.toFixed(2)} pt</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.00" 
                    max="5.00" 
                    step="0.05" 
                    value={ema24Slope} 
                    onChange={(e) => setEma24Slope(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--primary)', height: '4px', borderRadius: '2px', outline: 'none' }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  Performance test: one 15-tick favorable brick before the signal tail is exceeded by 2 ticks.
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
                <div>Bricks: {chartData.length}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Click on any Renko brick body or wick to add/edit annotations.</div>
              </div>
              <ChartComponent
                data={chartData}
                annotations={mergedAnnotations}
                onBrickClick={handleBrickClick}
                bookmark={bookmark}
                onSetBookmark={handleBookmarkBrick}
                onClearBookmark={handleClearBookmark}
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

        {/* Annotations Log Panel */}
        <section className="details-panel">
          <div className="panel-header">
            <h3 className="section-title" style={{ margin: 0 }}>Annotations Log</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Total Marked: {currentAnnotations.length}
            </span>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {currentAnnotations.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                No annotations added to this dataset yet. Click on the chart to start training the algorithm.
              </div>
            ) : (
              <table className="annotations-table">
                <thead>
                  <tr>
                    <th>Timestamp (ISO)</th>
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
                  {currentAnnotations.map((ann, i) => (
                    <tr
                      key={i}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        // Find matching brick in chartData
                        const indexedBrick = Number.isInteger(ann.barIndex) ? chartData[ann.barIndex] : null;
                        const brick = indexedBrick || chartData.find(d =>
                          d.time === ann.timestamp && metricsMatchBrick(ann.metrics, d)
                        );
                        if (brick) {
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
        </section>
      </main>

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
                  {isEditing ? 'Modify Annotation' : 'Add Trade Annotation'}
                </span>
              </div>
              <button 
                onClick={() => setModalOpen(false)}
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
              <div className="stat-item" style={{ gridColumn: 'span 2' }}>
                <span className="stat-label">8 EMA</span>
                <span className="stat-value" style={{ color: 'var(--primary)' }}>
                  {selectedBrick.ema ? selectedBrick.ema.toFixed(4) : 'N/A'}
                </span>
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
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveAnnotation}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
