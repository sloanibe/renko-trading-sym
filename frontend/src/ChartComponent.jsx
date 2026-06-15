import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

const SESSION_OPEN_TIME = '06:30:00';

const getSessionOpenIndices = (data) => {
  const firstBarByDate = new Map();
  data.forEach((bar, index) => {
    const [date, time = ''] = bar.time.replace('Z', '').split('T');
    if (time >= SESSION_OPEN_TIME && !firstBarByDate.has(date)) {
      firstBarByDate.set(date, index);
    }
  });
  return [...firstBarByDate.values()];
};

// Combined Renko overlay primitive for drawing 15-point custom grid lines and bold wicks
class RenkoOverlayPrimitive {
  constructor(data, options = {}) {
    this._data = data;
    this._options = options;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;

    this._minPrice = Infinity;
    this._maxPrice = -Infinity;
    this._calculatePriceRange();
  }

  updateData(data) {
    this._data = data;
    this._calculatePriceRange();
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  _calculatePriceRange() {
    if (!this._data || this._data.length === 0) {
      this._minPrice = Infinity;
      this._maxPrice = -Infinity;
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    this._data.forEach((item) => {
      if (item.low < min) min = item.low;
      if (item.high > max) max = item.high;
    });
    this._minPrice = min;
    this._maxPrice = max;
  }

  attached(param) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() {
    return [new RenkoOverlayPaneView(this)];
  }
}

class RenkoOverlayPaneView {
  constructor(primitive) {
    this._primitive = primitive;
  }

  zOrder() {
    return 'normal'; // Draw on the standard series layer to ensure visibility over background
  }

  renderer() {
    return new RenkoOverlayRenderer(this._primitive);
  }
}

class RenkoOverlayRenderer {
  constructor(primitive) {
    this._primitive = primitive;
  }

  draw(target) {
    const chart = this._primitive._chart;
    const series = this._primitive._series;
    const data = this._primitive._data;
    const options = this._primitive._options;
    const brickSize = options.brickSize || 15.0;

    const minPrice = this._primitive._minPrice;
    const maxPrice = this._primitive._maxPrice;

    if (!chart || !series || !data || data.length === 0 || minPrice === Infinity || maxPrice === -Infinity) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const horizontalPixelRatio = scope.horizontalPixelRatio;
      const verticalPixelRatio = scope.verticalPixelRatio;

      // 1. Draw Custom 15-Point Grid Lines
      const startPrice = Math.floor((minPrice - 150) / brickSize) * brickSize;
      const endPrice = Math.ceil((maxPrice + 150) / brickSize) * brickSize;

      ctx.lineWidth = (options.gridLineWidth || 1) * verticalPixelRatio;
      ctx.strokeStyle = options.gridColor || 'rgba(0, 0, 0, 0.16)'; // Faint black lines for gray background
      ctx.setLineDash([]); // Solid grid lines

      const width = scope.bitmapWidth;

      for (let price = startPrice; price <= endPrice; price += brickSize) {
        const roundedPrice = Math.round(price * 100) / 100;
        const yCoordinate = series.priceToCoordinate(roundedPrice);
        if (yCoordinate === null) continue;

        const y = yCoordinate * verticalPixelRatio;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // 2. Draw Bold 3px Wicks (on top of grid lines)
      ctx.lineWidth = (options.wickWidth || 3) * horizontalPixelRatio;
      ctx.strokeStyle = options.wickColor || '#000000';
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';

      data.forEach((item) => {
        const time = item.time;
        const xCoordinate = chart.timeScale().timeToCoordinate(time);
        if (xCoordinate === null) return; // Not visible on screen

        const openPrice = item.open;
        const closePrice = item.close;
        const highPrice = item.high;
        const lowPrice = item.low;

        let startPrice = openPrice;
        let endPrice = openPrice;

        if (closePrice > openPrice) {
          // Up bar: wick is at the bottom, from low to open
          startPrice = lowPrice;
          endPrice = openPrice;
        } else {
          // Down bar: wick is at the top, from open to high
          startPrice = openPrice;
          endPrice = highPrice;
        }

        const startY = series.priceToCoordinate(startPrice);
        const endY = series.priceToCoordinate(endPrice);

        if (startY === null || endY === null) return;

        const x = xCoordinate * horizontalPixelRatio;
        const yStart = startY * verticalPixelRatio;
        const yEnd = endY * verticalPixelRatio;

        ctx.beginPath();
        ctx.moveTo(x, yStart);
        ctx.lineTo(x, yEnd);
        ctx.stroke();
      });
    });
  }
}

class SessionDividerPrimitive {
  constructor(times, options = {}) {
    this._times = times;
    this._options = options;
    this._chart = null;
    this._paneViews = [new SessionDividerPaneView(this)];
  }

  attached(param) {
    this._chart = param.chart;
  }

  detached() {
    this._chart = null;
  }

  updateAllViews() {
    this._paneViews.forEach(view => view.update());
  }

  paneViews() {
    return this._paneViews;
  }

  get chart() {
    return this._chart;
  }

  get times() {
    return this._times;
  }

  get options() {
    return this._options;
  }
}

class SessionDividerPaneView {
  constructor(primitive) {
    this._primitive = primitive;
    this._positions = [];
  }

  update() {
    const timeScale = this._primitive.chart?.timeScale();
    this._positions = timeScale
      ? this._primitive.times
          .map(time => timeScale.timeToCoordinate(time))
          .filter(position => position !== null)
      : [];
  }

  zOrder() {
    return 'top';
  }

  renderer() {
    return new SessionDividerRenderer(this._positions, this._primitive.options);
  }
}

class SessionDividerRenderer {
  constructor(positions, options) {
    this._positions = positions;
    this._options = options;
  }

  draw(target) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const pixelRatio = scope.horizontalPixelRatio;
      ctx.lineWidth = (this._options.lineWidth || 2) * pixelRatio;
      ctx.strokeStyle = this._options.color || '#363636';
      ctx.setLineDash([9 * pixelRatio, 7 * pixelRatio]);

      this._positions.forEach((position) => {
        const x = position * pixelRatio;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, scope.bitmapSize.height);
        ctx.stroke();
      });

      ctx.setLineDash([]);
    });
  }
}


export default function ChartComponent({
  data,
  annotations,
  onBrickClick,
  bookmark,
  onSetBookmark,
  onClearBookmark,
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const emaSeriesRef = useRef(null);
  const markersPluginRef = useRef(null);
  const sliderRef = useRef(null);
  const crosshairBarIndexRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);

  // Button & Slider Handlers
  const handleSliderInput = (e) => {
    const chart = chartRef.current;
    if (!chart || !data) return;
    
    const start = parseFloat(e.target.value);
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      chart.timeScale().setVisibleLogicalRange({
        from: start,
        to: start + width,
      });
    }
  };

  const handleGoToStart = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      chart.timeScale().setVisibleLogicalRange({
        from: 0,
        to: width,
      });
    }
  };

  const handleGoToEnd = () => {
    const chart = chartRef.current;
    if (!chart || !data) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      chart.timeScale().setVisibleLogicalRange({
        from: data.length - width,
        to: data.length,
      });
    }
  };

  const handleScrollLeft = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      const shift = width * 0.2;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, logicalRange.from - shift),
        to: Math.max(width, logicalRange.to - shift),
      });
    }
  };

  const handleScrollRight = () => {
    const chart = chartRef.current;
    if (!chart || !data) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      const shift = width * 0.2;
      const maxFrom = data.length - width;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.min(maxFrom, logicalRange.from + shift),
        to: Math.min(data.length, logicalRange.to + shift),
      });
    }
  };

  const handleFitChart = () => {
    const chart = chartRef.current;
    if (chart) {
      chart.timeScale().fitContent();
    }
  };

  const goToBarIndex = (barIndex) => {
    const chart = chartRef.current;
    if (!chart || !data || !Number.isInteger(barIndex)) return;

    const currentRange = chart.timeScale().getVisibleLogicalRange();
    const width = currentRange ? currentRange.to - currentRange.from : Math.min(150, data.length);
    const safeWidth = Math.max(10, Math.min(width, data.length));
    const maxFrom = Math.max(0, data.length - safeWidth);
    const from = Math.max(0, Math.min(maxFrom, barIndex - safeWidth / 2));
    chart.timeScale().setVisibleLogicalRange({
      from,
      to: from + safeWidth,
    });
  };

  const handleGoToBookmark = () => {
    goToBarIndex(bookmark?.barIndex);
  };

  const getNavigationAnchorIndex = () => {
    if (Number.isInteger(crosshairBarIndexRef.current)) {
      return crosshairBarIndexRef.current;
    }
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    if (!range || !data?.length) return data.length - 1;
    return Math.max(0, Math.min(data.length - 1, Math.round((range.from + range.to) / 2)));
  };

  const handleGoToSessionOpen = () => {
    const sessionOpens = getSessionOpenIndices(data || []);
    const anchorIndex = getNavigationAnchorIndex();
    const currentSession = sessionOpens.filter(index => index <= anchorIndex).at(-1);
    if (Number.isInteger(currentSession)) goToBarIndex(currentSession);
  };

  const handleGoToPreviousSession = () => {
    const sessionOpens = getSessionOpenIndices(data || []);
    const anchorIndex = getNavigationAnchorIndex();
    const currentPosition = sessionOpens.findLastIndex(index => index <= anchorIndex);
    const previousSession = sessionOpens[currentPosition - 1];
    if (Number.isInteger(previousSession)) goToBarIndex(previousSession);
  };

  const handleZoomIn = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      const center = (logicalRange.from + logicalRange.to) / 2;
      const newWidth = Math.max(10, width * 0.7); // Zoom in by 30%
      chart.timeScale().setVisibleLogicalRange({
        from: center - newWidth / 2,
        to: center + newWidth / 2,
      });
    }
  };

  const handleZoomOut = () => {
    const chart = chartRef.current;
    if (!chart || !data) return;
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (logicalRange) {
      const width = logicalRange.to - logicalRange.from;
      const center = (logicalRange.from + logicalRange.to) / 2;
      const newWidth = Math.min(data.length, width * 1.4); // Zoom out by 40%
      chart.timeScale().setVisibleLogicalRange({
        from: center - newWidth / 2,
        to: center + newWidth / 2,
      });
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    // Lightweight Charts requires unique ascending times. Keep those internal
    // chart keys separate from the original MultiCharts completion timestamps.
    const originalTimeByChartTime = new Map();
    const barIndexByChartTime = new Map();
    let lastTime = 0;
    const formattedData = data.map((item, index) => {
      let chartTime = Math.floor(Date.parse(item.time.endsWith('Z') ? item.time : `${item.time}Z`) / 1000);
      if (isNaN(chartTime) || chartTime <= lastTime) {
        chartTime = lastTime + 1;
      }
      lastTime = chartTime;
      originalTimeByChartTime.set(chartTime, item.time);
      barIndexByChartTime.set(chartTime, index);
      return {
        ...item,
        originalTime: item.time,
        originalIndex: index,
        time: chartTime,
      };
    });

    // (50 EMA calculation removed)

    const getOriginalDate = (chartTime) => {
      const originalTime = originalTimeByChartTime.get(chartTime);
      if (!originalTime) return new Date(chartTime * 1000);
      return new Date(originalTime.endsWith('Z') ? originalTime : `${originalTime}Z`);
    };

    const formatOriginalTime = (chartTime, includeDate = false) => {
      const date = getOriginalDate(chartTime);
      const hours = String(date.getUTCHours()).padStart(2, '0');
      const minutes = String(date.getUTCMinutes()).padStart(2, '0');
      const seconds = String(date.getUTCSeconds()).padStart(2, '0');
      if (!includeDate) return `${hours}:${minutes}:${seconds}`;

      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    // Create Chart Instance
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { color: '#9c9c9c' }, // MultiCharts neutral gray background
        textColor: '#000000', // Black labels for high contrast on gray background
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(0, 0, 0, 0.08)' },
        horzLines: { visible: false }, // Disable native horizontal lines (using custom 15pt grid)
      },
      crosshair: {
        mode: 1, // Normal crosshair
        vertLine: {
          color: '#334155',
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: '#334155',
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(0, 0, 0, 0.15)',
        autoScale: true,
        scaleMargins: {
          top: 0.15,
          bottom: 0.15,
        },
      },
      timeScale: {
        borderColor: 'rgba(0, 0, 0, 0.15)',
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 18, // Zoom in by default to make wicks and bars visually thicker
        tickMarkFormatter: (time, tickMarkType) => {
          const date = getOriginalDate(time);
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          switch (tickMarkType) {
            case 0: // Year
              return String(date.getUTCFullYear());
            case 1: // Month
              return MONTHS[date.getUTCMonth()];
            case 2: // DayOfMonth
              return String(date.getUTCDate());
            case 3: // Time
            case 4: // TimeWithSeconds
              return formatOriginalTime(time);
            default:
              return '';
          }
        },
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (timestamp) => formatOriginalTime(timestamp, true),
      },
    });

    chartRef.current = chart;

    // Add Candlestick Series (for Renko Bricks + Wicks)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#004cff',       // Lightened vibrant royal blue
      downColor: '#cc1a1a',     // Lightened vibrant deep red
      borderVisible: true,      // Keep borders
      borderUpColor: '#000000', // Solid black borders for crisp definition
      borderDownColor: '#000000',
      wickVisible: false,      // Hide default 1px wicks (our custom primitive draws thick wicks)
    });
    candlestickSeriesRef.current = candlestickSeries;

    // Add Line Series (for the 8 EMA)
    const emaSeries = chart.addSeries(LineSeries, {
      color: '#008000',         // MultiCharts Green for EMA
      lineWidth: 2,
      priceLineVisible: false,  // Hide horizontal current price line for EMA
    });
    emaSeriesRef.current = emaSeries;

    // (50 EMA series declaration removed)

    // Populate Candlestick Series
    const candleData = formattedData.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    candlestickSeries.setData(candleData);

    const sessionOpenTimes = getSessionOpenIndices(data).map(index => formattedData[index].time);

    // Attach custom bold wicks and 15pt grid overlay primitive
    const renkoOverlay = new RenkoOverlayPrimitive(formattedData, {
      wickWidth: 3, // 3 pixels wide
      wickColor: '#000000',
      brickSize: 15.0, // Align custom grid lines with 15pt Renko
      gridColor: 'rgba(0, 0, 0, 0.18)',
    });
    candlestickSeries.attachPrimitive(renkoOverlay);
    candlestickSeries.attachPrimitive(new SessionDividerPrimitive(sessionOpenTimes, {
      color: '#363636',
      lineWidth: 2,
    }));

    // Populate EMA Series
    const emaData = formattedData
      .filter(d => d.ema !== undefined && d.ema !== null)
      .map(d => ({
        time: d.time,
        value: d.ema,
      }));
    emaSeries.setData(emaData);

    // (50 EMA data binding removed)

    // Set initial visible range (show last 150 bars to be zoomed in and readable)
    const totalBars = formattedData.length;
    const defaultVisibleBars = 150;
    if (totalBars > defaultVisibleBars) {
      chart.timeScale().setVisibleLogicalRange({
        from: totalBars - defaultVisibleBars,
        to: totalBars,
      });
    } else {
      chart.timeScale().fitContent();
    }

    // Sync slider with chart scroll
    const handleVisibleRangeChange = (logicalRange) => {
      if (!logicalRange) return;
      const from = logicalRange.from;
      const to = logicalRange.to;
      const width = to - from;
      if (sliderRef.current) {
        const maxVal = Math.max(0, formattedData.length - width);
        sliderRef.current.max = maxVal;
        sliderRef.current.value = Math.min(maxVal, Math.max(0, from));
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    chart.subscribeCrosshairMove((param) => {
      if (!param?.time) return;
      const barIndex = barIndexByChartTime.get(param.time);
      if (Number.isInteger(barIndex)) crosshairBarIndexRef.current = barIndex;
    });

    const handleContextMenu = (event) => {
      if (!chartContainerRef.current) return;

      const rect = chartContainerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const logicalIndex = chart.timeScale().coordinateToLogical(x);
      const barIndex = logicalIndex === null ? -1 : Math.round(logicalIndex);
      const clickedBrick = formattedData[barIndex];
      if (!clickedBrick) return;

      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        brick: clickedBrick,
      });
    };

    chartContainerRef.current.addEventListener('contextmenu', handleContextMenu, true);

    // Handle Clicks for Annotation Placement (only on the actual bar)
    chart.subscribeClick((param) => {
      if (!param || !param.time || !param.point) return;

      // Find the clicked Renko brick in our formatted dataset
      const clickedBrick = formattedData.find(d => d.time === param.time);
      if (clickedBrick && chartContainerRef.current) {
        const yClick = param.point.y;
        const yHigh = candlestickSeries.priceToCoordinate(clickedBrick.high);
        const yLow = candlestickSeries.priceToCoordinate(clickedBrick.low);

        if (yHigh !== null && yLow !== null) {
          const padding = 8; // 8px tolerance padding for easier clicking
          if (yClick >= yHigh - padding && yClick <= yLow + padding) {
            const rect = chartContainerRef.current.getBoundingClientRect();
            const viewportX = rect.left + param.point.x;
            const viewportY = rect.top + param.point.y;
            onBrickClick(clickedBrick, { x: viewportX, y: viewportY });
          }
        }
      }
    });

    // Handle Resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.resize(
          chartContainerRef.current.clientWidth,
          chartContainerRef.current.clientHeight
        );
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartContainerRef.current?.removeEventListener('contextmenu', handleContextMenu, true);
      chart.remove();
      markersPluginRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (Number.isInteger(bookmark?.barIndex)) {
      goToBarIndex(bookmark.barIndex);
    }
  }, [bookmark, data]);

  // Synchronize Markers (Annotations) whenever annotations or data updates
  useEffect(() => {
    if (!candlestickSeriesRef.current || !data || data.length === 0) return;

    // Recalculate formatted times mapping to map database ISO times back to chart unix times
    let lastTime = 0;
    const formattedBars = [];
    const timeMapping = {}; // ISO String -> Unix Timestamp (legacy fallback)
    data.forEach((item, index) => {
      // Append 'Z' to treat the date as UTC and match the price series timestamps
      let t = Math.floor(Date.parse(item.time + 'Z') / 1000);
      if (isNaN(t)) {
        t = lastTime + 1;
      }
      if (t <= lastTime) {
        t = lastTime + 1;
      }
      lastTime = t;
      timeMapping[item.time] = t;
      formattedBars.push({
        ...item,
        originalIndex: index,
        chartTime: t,
      });
    });

    const resolveAnnotationTime = (ann) => {
      if (Number.isInteger(ann.barIndex) && formattedBars[ann.barIndex]) {
        return formattedBars[ann.barIndex].chartTime;
      }

      const candidates = formattedBars.filter(bar => bar.time === ann.timestamp);
      if (candidates.length === 0) return timeMapping[ann.timestamp];
      if (!ann.metrics) return candidates[candidates.length - 1].chartTime;

      const metricKeys = ['open', 'high', 'low', 'close', 'ema'];
      const bestMatch = candidates.reduce((best, candidate) => {
        const score = metricKeys.reduce((total, key) => {
          const expected = ann.metrics[key];
          const actual = candidate[key];
          if (!Number.isFinite(expected) || !Number.isFinite(actual)) return total;
          return total + Math.abs(actual - expected);
        }, 0);

        return !best || score < best.score ? { candidate, score } : best;
      }, null);

      return bestMatch?.candidate.chartTime;
    };

    // Build Chart Markers
    const markers = [];
    if (annotations && annotations.length > 0) {
      annotations.forEach(ann => {
        const chartTime = resolveAnnotationTime(ann);
        if (chartTime) {
          if (ann.isCampaignEntry) {
            markers.push({
              time: chartTime,
              position: ann.action === 'Buy' ? 'belowBar' : 'aboveBar',
              color: ann.action === 'Buy' ? '#1d4ed8' : '#a21caf', // Dark Royal Blue for Buy, Dark Magenta for Sell
              shape: ann.action === 'Buy' ? 'arrowUp' : 'arrowDown',
              text: `${ann.action === 'Buy' ? '🔑 BUY' : '🔑 SELL'} #${ann.tradeIndex}`,
            });
          } else if (ann.isCampaignExit) {
            let color = '#475569'; // Dark Slate for BE/End
            let shape = 'circle';
            let label = `EXIT #${ann.tradeIndex}`;
            
            if (ann.exitResult === 'Win') {
              const profit = Number(ann.profitBricks) !== undefined && Number.isFinite(ann.profitBricks) ? Number(ann.profitBricks) : 2.0;
              const profitStr = profit >= 0 ? `+${profit.toFixed(1)}` : profit.toFixed(1);
              color = '#15803d'; // Dark Forest Green
              shape = 'square';
              label = `🏆 WIN #${ann.tradeIndex} (${profitStr})`;
            } else if (ann.exitResult === 'Loss') {
              const profit = Number(ann.profitBricks) !== undefined && Number.isFinite(ann.profitBricks) ? Number(ann.profitBricks) : -2.0;
              const profitStr = profit >= 0 ? `+${profit.toFixed(1)}` : profit.toFixed(1);
              color = '#b91c1c'; // Dark Crimson Red
              shape = 'square';
              label = `❌ LOSS #${ann.tradeIndex} (${profitStr})`;
            } else if (ann.exitResult === 'BE') {
              color = '#475569'; // Dark Slate Gray
              shape = 'circle';
              label = `🤝 BE #${ann.tradeIndex}`;
            } else if (ann.exitResult === 'Trail') {
              const profit = Number(ann.profitBricks) || 0;
              const profitStr = profit >= 0 ? `+${profit.toFixed(1)}` : profit.toFixed(1);
              color = profit >= 0 ? '#15803d' : '#b91c1c';
              shape = 'square';
              label = `🏃 TRAIL #${ann.tradeIndex} (${profitStr})`;
            } else if (ann.exitResult === 'EndSession') {
              color = '#475569';
              shape = 'circle';
              label = `🚪 END #${ann.tradeIndex}`;
            }
            
            markers.push({
              time: chartTime,
              position: ann.direction === 'Buy' ? 'aboveBar' : 'belowBar', // Exit is opposite to entry direction
              color: color,
              shape: shape,
              text: label,
            });
          } else if (ann.action === 'Buy') {
            let markerText = ann.isSystem ? 'SYS BUY' : 'TEACH BUY';
            if (ann.isSystem && ann.evaluationResult) {
              if (ann.evaluationResult === 'Pass') {
                markerText = 'SYS BUY (+)';
              } else if (ann.evaluationResult === 'Fail') {
                markerText = 'SYS BUY (-)';
              } else if (ann.evaluationResult === 'Pending') {
                markerText = 'SYS BUY (?)';
              }
            }
            markers.push({
              time: chartTime,
              position: 'belowBar',
              color: ann.isSystem ? '#14532d' : '#15803d', // Very dark forest green for system, dark green for user
              shape: 'arrowUp',
              text: markerText,
            });
          } else if (ann.action === 'Sell') {
            let markerText = ann.isSystem ? 'SYS SELL' : 'TEACH SELL';
            if (ann.isSystem && ann.evaluationResult) {
              if (ann.evaluationResult === 'Pass') {
                markerText = 'SYS SELL (+)';
              } else if (ann.evaluationResult === 'Fail') {
                markerText = 'SYS SELL (-)';
              } else if (ann.evaluationResult === 'Pending') {
                markerText = 'SYS SELL (?)';
              }
            }
            markers.push({
              time: chartTime,
              position: 'aboveBar',
              color: ann.isSystem ? '#7f1d1d' : '#b91c1c', // Very dark red for system, crimson for user
              shape: 'arrowDown',
              text: markerText,
            });
          } else if (ann.action === 'Skip') {
            markers.push({
              time: chartTime,
              position: 'aboveBar',
              color: '#c2410c', // Dark Amber Orange
              shape: 'circle',
              text: 'TEACH SKIP',
            });
          }
        }
      });
    }

    markers.sort((a, b) => a.time - b.time);

    if (!markersPluginRef.current) {
      markersPluginRef.current = createSeriesMarkers(candlestickSeriesRef.current, markers);
    } else {
      markersPluginRef.current.setMarkers(markers);
    }
  }, [annotations, data]);

  return (
    <div className="chart-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={chartContainerRef} style={{ flex: 1, minHeight: 0 }} />
      {contextMenu && (
        <div
          className="chart-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={event => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onSetBookmark(contextMenu.brick);
              setContextMenu(null);
            }}
          >
            Bookmark This Bar
          </button>
        </div>
      )}
      <div className="chart-controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', minWidth: '40px' }}>Start</span>
          <input
            ref={sliderRef}
            type="range"
            min="0"
            max={data ? Math.max(0, data.length - 150) : 100}
            defaultValue="0"
            onInput={handleSliderInput}
            className="timeline-slider"
          />
          <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'right' }}>End</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handleGoToPreviousSession}
            className="control-btn"
            title="Go to the previous trading session open"
          >
            Previous Session
          </button>
          <button
            onClick={handleGoToSessionOpen}
            className="control-btn"
            title="Go to the 06:30 open for the visible trading session"
          >
            Session Open 06:30
          </button>
          <button
            onClick={handleGoToBookmark}
            className="control-btn"
            title={bookmark ? `Go to bookmark at ${bookmark.timestamp}` : 'No bookmark saved'}
            disabled={!bookmark}
          >
            Go to Bookmark
          </button>
          <button
            onClick={onClearBookmark}
            className="control-btn"
            title="Clear saved bookmark"
            disabled={!bookmark}
          >
            Clear Bookmark
          </button>
          <button onClick={handleGoToStart} className="control-btn" title="Go to Beginning">⏮ Go to Start</button>
          <button onClick={handleScrollLeft} className="control-btn" title="Scroll Left">◀ Scroll Left</button>
          <button onClick={handleZoomOut} className="control-btn" title="Zoom Out">➖ Zoom Out</button>
          <button onClick={handleFitChart} className="control-btn" title="Show All Data">🔍 Fit All</button>
          <button onClick={handleZoomIn} className="control-btn" title="Zoom In">➕ Zoom In</button>
          <button onClick={handleScrollRight} className="control-btn" title="Scroll Right">Scroll Right ▶</button>
          <button onClick={handleGoToEnd} className="control-btn" title="Go to Latest">Go to End ⏭</button>
        </div>
      </div>
    </div>
  );
}
