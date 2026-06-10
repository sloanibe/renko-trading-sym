import React, { useState, useEffect } from 'react';
import ChartComponent from './ChartComponent';

const API_BASE = 'http://localhost:5000/api';

export default function App() {
  const [charts, setCharts] = useState([]);
  const [activeChart, setActiveChart] = useState('');
  const [chartData, setChartData] = useState([]);
  const [allAnnotations, setAllAnnotations] = useState({});
  const [selectedBrick, setSelectedBrick] = useState(null);
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Draggable Modal state
  const [modalPosition, setModalPosition] = useState({ x: 100, y: 100 });
  const [dragStart, setDragStart] = useState(null);

  // Center modal initially when it is opened
  useEffect(() => {
    if (modalOpen) {
      const width = 480;
      const height = 450;
      const x = Math.max(20, (window.innerWidth - width) / 2);
      const y = Math.max(20, (window.innerHeight - height) / 2);
      setModalPosition({ x, y });
    }
  }, [modalOpen]);

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

  // Fetch chart data when active selection changes
  useEffect(() => {
    if (activeChart) {
      fetchChartData(activeChart);
    } else {
      setChartData([]);
    }
  }, [activeChart]);

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

  const handleBrickClick = (brick) => {
    // Check if an annotation already exists for this brick's timestamp
    const activeAnnotations = allAnnotations[activeChart] || [];
    const targetTime = brick.originalTime || brick.time;
    const existing = activeAnnotations.find(a => a.timestamp === targetTime || a.timestamp === brick.time);
    
    setSelectedBrick(brick);
    if (existing) {
      setSelectedAction(existing.action);
      setCommentText(existing.comment || '');
      setIsEditing(true);
    } else {
      // Auto-prepopulate: Buy for Up bars (close > open), Sell for Down-bars (close < open)
      const defaultAction = brick.close > brick.open ? 'Buy' : 'Sell';
      setSelectedAction(defaultAction);
      setCommentText('');
      setIsEditing(false);
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

    const index = activeAnnotations.findIndex(a => a.timestamp === targetTime || a.timestamp === selectedBrick.time);
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
      await fetch(`${API_BASE}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: activeChart, annotations: activeAnnotations }),
      });
    } catch (err) {
      console.error('Failed to save annotation:', err);
      alert('Failed to persist annotation to disk');
    }
  };

  const handleDeleteAnnotation = async () => {
    if (!selectedBrick) return;

    const targetTime = selectedBrick.originalTime || selectedBrick.time;
    const activeAnnotations = (allAnnotations[activeChart] || []).filter(
      a => a.timestamp !== targetTime && a.timestamp !== selectedBrick.time
    );

    // Optimistically update UI
    const updated = { ...allAnnotations, [activeChart]: activeAnnotations };
    setAllAnnotations(updated);
    setModalOpen(false);

    try {
      await fetch(`${API_BASE}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: activeChart, annotations: activeAnnotations }),
      });
    } catch (err) {
      console.error('Failed to delete annotation:', err);
      alert('Failed to delete annotation on disk');
    }
  };

  const savedAnnotations = allAnnotations[activeChart] || [];

  // Construct annotations to pass to ChartComponent, including a temporary preview if the modal is open
  const currentAnnotations = React.useMemo(() => {
    if (!modalOpen || !selectedBrick) {
      return savedAnnotations;
    }

    const previewAnn = {
      timestamp: selectedBrick.originalTime || selectedBrick.time,
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

    const targetTime = selectedBrick.originalTime || selectedBrick.time;
    const exists = savedAnnotations.some(a => a.timestamp === targetTime);

    if (exists) {
      return savedAnnotations.map(a => a.timestamp === targetTime ? previewAnn : a);
    } else {
      return [...savedAnnotations, previewAnn];
    }
  }, [savedAnnotations, modalOpen, selectedBrick, selectedAction, commentText]);

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

        {/* Details card */}
        {chartData.length > 0 && (
          <div style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '12px' }}>
            <h4 style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '13px', fontWeight: '600' }}>Active Dataset Stats</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total Bricks:</span>
                <span style={{ fontWeight: '600' }}>{chartData.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Annotations:</span>
                <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{currentAnnotations.length}</span>
              </div>
            </div>
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
                annotations={currentAnnotations}
                onBrickClick={handleBrickClick}
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
                        const brick = chartData.find(d => d.time === ann.timestamp);
                        if (brick) handleBrickClick(brick);
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
              Timestamp: <span style={{ fontFamily: 'monospace' }}>{selectedBrick.time}</span>
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
