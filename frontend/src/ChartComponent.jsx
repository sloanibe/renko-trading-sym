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

const inferBrickSize = (data) => {
  const counts = new Map();
  (data || []).forEach((bar) => {
    const size = Math.abs(Number(bar.close) - Number(bar.open));
    if (!Number.isFinite(size) || size <= 0) return;
    const key = size.toFixed(10);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const [size] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [15];
  return Number(size);
};

const formatChartData = (data) => {
  const originalTimeByChartTime = new Map();
  const barIndexByChartTime = new Map();
  let lastTime = 0;
  const formattedData = (data || []).map((item, index) => {
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
      timeMs: chartTime * 1000,
    };
  });

  return { formattedData, originalTimeByChartTime, barIndexByChartTime };
};

const getOriginalDateForChartTime = (chartTime, originalTimeByChartTime) => {
  const originalTime = originalTimeByChartTime.get(chartTime);
  if (!originalTime) return new Date(chartTime * 1000);
  return new Date(originalTime.endsWith('Z') ? originalTime : `${originalTime}Z`);
};

const formatOriginalChartTime = (chartTime, originalTimeByChartTime, includeDate = false) => {
  const date = getOriginalDateForChartTime(chartTime, originalTimeByChartTime);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  if (!includeDate) return `${hours}:${minutes}:${seconds}`;

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const parseOriginalTimeMs = (originalTime) => {
  if (!originalTime) return NaN;
  return Date.parse(originalTime.endsWith('Z') ? originalTime : `${originalTime}Z`);
};

const formatSelectionTime = (originalTime) => {
  const date = new Date(originalTime.endsWith('Z') ? originalTime : `${originalTime}Z`);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const findNearestBarByMs = (formattedData, targetMs) => {
  if (!formattedData?.length || Number.isNaN(targetMs)) return null;

  let low = 0;
  let high = formattedData.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midMs = formattedData[mid].timeMs;
    if (midMs < targetMs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const candidates = [high, low]
    .filter(index => index >= 0 && index < formattedData.length)
    .map(index => formattedData[index]);
  return candidates.reduce((best, candidate) => {
    const delta = Math.abs(candidate.timeMs - targetMs);
    if (!best || delta < best.delta) return { bar: candidate, delta };
    return best;
  }, null)?.bar || null;
};

// Combined Renko overlay primitive for drawing 15-point custom grid lines and bold wicks
class RenkoOverlayPrimitive {
  constructor(data, options = {}) {
    this._data = data;
    this._options = options;
    this._virtualBricks = [];
    this._aridELabels = [];
    this._teachLabels = [];
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

  updateVirtualBricks(virtualBricks) {
    this._virtualBricks = virtualBricks || [];
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  updateAridELabels(labels) {
    this._aridELabels = labels || [];
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  updateTeachLabels(labels) {
    this._teachLabels = labels || [];
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
    const virtualBricks = this._primitive._virtualBricks;
    const aridELabels = this._primitive._aridELabels;
    const brickSize = options.brickSize || 15.0;

    const minPrice = this._primitive._minPrice;
    const maxPrice = this._primitive._maxPrice;

    if (!chart || !series || !data || data.length === 0 || minPrice === Infinity || maxPrice === -Infinity) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const horizontalPixelRatio = scope.horizontalPixelRatio;
      const verticalPixelRatio = scope.verticalPixelRatio;
      const visibleRange = chart.timeScale().getVisibleLogicalRange();
      const firstVisibleIndex = visibleRange
        ? Math.max(0, Math.floor(visibleRange.from) - 1)
        : 0;
      const lastVisibleIndex = visibleRange
        ? Math.min(data.length - 1, Math.ceil(visibleRange.to) + 1)
        : data.length - 1;
      const barSpacing = chart.timeScale().options().barSpacing;

      // 1. Draw Custom 15-Point Grid Lines (optimized to visible range)
      const priceScaleRange = chart.priceScale('right').getVisibleRange();
      const visibleMinPrice = priceScaleRange && Number.isFinite(priceScaleRange.from) ? priceScaleRange.from : minPrice;
      const visibleMaxPrice = priceScaleRange && Number.isFinite(priceScaleRange.to) ? priceScaleRange.to : maxPrice;

      const startPrice = Math.floor((visibleMinPrice - brickSize) / brickSize) * brickSize;
      const endPrice = Math.ceil((visibleMaxPrice + brickSize) / brickSize) * brickSize;

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

      for (let index = firstVisibleIndex; index <= lastVisibleIndex; index += 1) {
        const item = data[index];
        const xCoordinate = chart.timeScale().timeToCoordinate(item.time);
        if (xCoordinate === null) continue;

        const isUp = item.close > item.open;
        const startPrice = isUp ? item.low : item.open;
        const endPrice = isUp ? item.open : item.high;
        const startY = series.priceToCoordinate(startPrice);
        const endY = series.priceToCoordinate(endPrice);
        if (startY === null || endY === null) continue;

        const x = xCoordinate * horizontalPixelRatio;
        ctx.beginPath();
        ctx.moveTo(x, startY * verticalPixelRatio);
        ctx.lineTo(x, endY * verticalPixelRatio);
        ctx.stroke();
      }

      // 3. Draw solid Renko bodies edge-to-edge, matching MultiCharts geometry.
      ctx.lineWidth = (options.bodyBorderWidth || 1) * horizontalPixelRatio;
      ctx.setLineDash([]);

      for (let index = firstVisibleIndex; index <= lastVisibleIndex; index += 1) {
        const item = data[index];
        const x = chart.timeScale().timeToCoordinate(item.time);
        if (x === null) continue;

        const openY = series.priceToCoordinate(item.open);
        const closeY = series.priceToCoordinate(item.close);
        if (openY === null || closeY === null) continue;

        const totalBarWidth = barSpacing * horizontalPixelRatio;
        const gap = Math.max(horizontalPixelRatio, Math.round(totalBarWidth * 0.25));
        const rectLeft = (x - barSpacing / 2) * horizontalPixelRatio + gap / 2;
        const rectTop = Math.min(openY, closeY) * verticalPixelRatio;
        const rectWidth = Math.max(horizontalPixelRatio, totalBarWidth - gap);
        const rectHeight = Math.max(
          verticalPixelRatio,
          Math.abs(closeY - openY) * verticalPixelRatio
        );

        ctx.fillStyle = item.close >= item.open
          ? (options.upColor || '#004cff')
          : (options.downColor || '#cc1a1a');
        ctx.strokeStyle = options.bodyBorderColor || '#000000';
        ctx.fillRect(rectLeft, rectTop, rectWidth, rectHeight);
        ctx.strokeRect(rectLeft, rectTop, rectWidth, rectHeight);
      }

      // 4. Draw projected hollow pullbacks and their entry arrows.
      ctx.lineWidth = 2 * horizontalPixelRatio;
      ctx.setLineDash([]);

      virtualBricks.forEach((virtual) => {
        if (virtual.barIndex < firstVisibleIndex || virtual.barIndex > lastVisibleIndex) return;
        const sourceBar = data[virtual.barIndex];
        if (!sourceBar) return;

        const x = chart.timeScale().timeToCoordinate(sourceBar.time);
        const openY = series.priceToCoordinate(virtual.open);
        const closeY = series.priceToCoordinate(virtual.close);
        if (x === null || openY === null || closeY === null) return;

        const totalBarWidth = barSpacing * horizontalPixelRatio;
        const gap = Math.max(horizontalPixelRatio, Math.round(totalBarWidth * 0.25));
        const rectLeft = (x - barSpacing / 2) * horizontalPixelRatio + gap / 2;
        const rectTop = Math.min(openY, closeY) * verticalPixelRatio;
        const rectWidth = Math.max(horizontalPixelRatio, totalBarWidth - gap);
        const rectHeight = Math.max(verticalPixelRatio, Math.abs(closeY - openY) * verticalPixelRatio);
        const isBuy = virtual.action === 'Buy';

        ctx.strokeStyle = isBuy
          ? (options.downColor || '#cc1a1a')
          : (options.upColor || '#004cff');
        ctx.strokeRect(rectLeft, rectTop, rectWidth, rectHeight);

        const centerX = rectLeft + rectWidth / 2;
        const arrowHalfWidth = Math.min(rectWidth * 0.28, 5 * horizontalPixelRatio);
        const arrowHeight = 7 * verticalPixelRatio;
        const arrowGap = 4 * verticalPixelRatio;
        ctx.fillStyle = isBuy
          ? (options.upColor || '#004cff')
          : (options.downColor || '#cc1a1a');
        ctx.beginPath();
        if (isBuy) {
          const arrowTop = rectTop + rectHeight + arrowGap;
          ctx.moveTo(centerX, arrowTop);
          ctx.lineTo(centerX - arrowHalfWidth, arrowTop + arrowHeight);
          ctx.lineTo(centerX + arrowHalfWidth, arrowTop + arrowHeight);
        } else {
          const arrowBottom = rectTop - arrowGap;
          ctx.moveTo(centerX, arrowBottom);
          ctx.lineTo(centerX - arrowHalfWidth, arrowBottom - arrowHeight);
          ctx.lineTo(centerX + arrowHalfWidth, arrowBottom - arrowHeight);
        }
        ctx.closePath();
        ctx.fill();

        if (virtual.label) {
          ctx.font = `700 ${14 * verticalPixelRatio}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = isBuy ? 'top' : 'bottom';
          ctx.fillStyle = isBuy
            ? (options.upColor || '#004cff')
            : (options.downColor || '#cc1a1a');
          const labelY = isBuy
            ? rectTop + rectHeight + arrowGap + arrowHeight + 8 * verticalPixelRatio
            : rectTop - arrowGap - arrowHeight - 8 * verticalPixelRatio;
          ctx.fillText(virtual.label, centerX, labelY);
        }
      });

      // 5. Draw larger ARID-E labels for actual pullback markers with extra clearance.
      ctx.font = `700 ${14 * verticalPixelRatio}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      aridELabels.forEach((label) => {
        if (label.barIndex < firstVisibleIndex || label.barIndex > lastVisibleIndex) return;
        const sourceBar = data[label.barIndex];
        if (!sourceBar || !label.text) return;

        const xCoordinate = chart.timeScale().timeToCoordinate(sourceBar.time);
        const highY = series.priceToCoordinate(sourceBar.high);
        const lowY = series.priceToCoordinate(sourceBar.low);
        if (xCoordinate === null || highY === null || lowY === null) return;

        const isBuy = label.action === 'Buy';
        const x = xCoordinate * horizontalPixelRatio;
        const y = isBuy
          ? lowY * verticalPixelRatio + 28 * verticalPixelRatio
          : highY * verticalPixelRatio - 28 * verticalPixelRatio;
        ctx.textBaseline = isBuy ? 'top' : 'bottom';
        ctx.fillStyle = isBuy
          ? (options.upColor || '#004cff')
          : (options.downColor || '#cc1a1a');
        ctx.fillText(label.text, x, y);
      });

      // 6. Optional training labels. Disabled for the arrow-only chart view.
      ctx.font = `700 ${12 * verticalPixelRatio}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000000'; // Bold black font

      this._primitive._teachLabels.forEach((label) => {
        if (label.barIndex < firstVisibleIndex || label.barIndex > lastVisibleIndex) return;
        const sourceBar = data[label.barIndex];
        if (!sourceBar) return;

        const xCoordinate = chart.timeScale().timeToCoordinate(sourceBar.time);
        const highY = series.priceToCoordinate(sourceBar.high);
        const lowY = series.priceToCoordinate(sourceBar.low);
        if (xCoordinate === null || highY === null || lowY === null) return;

        const isBuy = label.action === 'Buy';
        const x = xCoordinate * horizontalPixelRatio;
        
        // Offset by 32px so they are clear of the 15px bar spacing and arrows
        const y = isBuy
          ? lowY * verticalPixelRatio + 32 * verticalPixelRatio
          : highY * verticalPixelRatio - 32 * verticalPixelRatio;
          
        ctx.textBaseline = isBuy ? 'top' : 'bottom';
        ctx.fillText(label.text, x, y);
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
  secondaryData = [],
  annotations,
  onBrickClick,
  onHaSelectionChange,
  bookmark,
  onSetBookmark,
  onClearBookmark,
  isRegularCandlestick = false,
  showSecondaryPane = true,
  onToggleSecondaryPane,
}) {
  const chartContainerRef = useRef(null);
  const panesContainerRef = useRef(null);
  const secondaryChartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const secondaryChartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const secondaryCandlestickSeriesRef = useRef(null);
  const ema5SeriesRef = useRef(null);
  const ema10SeriesRef = useRef(null);
  const secondaryMa1SeriesRef = useRef(null);
  const secondaryMa2SeriesRef = useRef(null);
  const renkoOverlayRef = useRef(null);
  const markersPluginRef = useRef(null);
  const sliderRef = useRef(null);
  const crosshairBarIndexRef = useRef(null);
  const primaryFormattedDataRef = useRef([]);
  const secondaryFormattedDataRef = useRef([]);
  const primaryBarByChartTimeRef = useRef(new Map());
  const secondaryBarByChartTimeRef = useRef(new Map());
  const isSyncingCrosshairRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const hasSecondaryPaneRef = useRef(false);
  const haSelectionRef = useRef(null);
  const haSelectionDragRef = useRef(null);
  const haSelectionModeRef = useRef(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [secondaryPanePercent, setSecondaryPanePercent] = useState(30);
  const [haSelectionMode, setHaSelectionMode] = useState(false);
  const [haSelection, setHaSelection] = useState(null);
  const haSelectionHighlightRef = useRef(null);

  const hasSecondaryPane = secondaryData && secondaryData.length > 0 && showSecondaryPane;
  hasSecondaryPaneRef.current = hasSecondaryPane;
  haSelectionModeRef.current = haSelectionMode;

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

  const centerSecondaryPaneOnTime = (originalTime) => {
    const chart = secondaryChartRef.current;
    const formattedData = secondaryFormattedDataRef.current;
    if (!chart || !formattedData?.length || !originalTime) return;

    const targetMs = parseOriginalTimeMs(originalTime);
    if (Number.isNaN(targetMs)) return;

    const nearestBar = findNearestBarByMs(formattedData, targetMs);
    const bestIndex = nearestBar?.originalIndex ?? 0;

    const currentRange = chart.timeScale().getVisibleLogicalRange();
    const currentWidth = currentRange ? currentRange.to - currentRange.from : 180;
    const visibleBars = Math.max(12, Math.min(formattedData.length, currentWidth || 180));
    const from = Math.max(0, Math.min(formattedData.length - visibleBars, bestIndex - visibleBars / 2));
    const to = from + visibleBars;
    chart.timeScale().setVisibleLogicalRange({
      from,
      to,
    });

    const visibleData = formattedData.slice(Math.floor(from), Math.ceil(to) + 1);
    const values = visibleData.flatMap(item => [
      item.high,
      item.low,
      item.ma1,
      item.ma2,
    ]).filter(Number.isFinite);
    if (values.length > 0) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const padding = Math.max((max - min) * 0.12, 0.5);
      chart.priceScale('right').setVisibleRange({
        from: min - padding,
        to: max + padding,
      });
    }
  };

  const centerPrimaryPaneOnTime = (originalTime) => {
    const chart = chartRef.current;
    const formattedData = primaryFormattedDataRef.current;
    if (!chart || !formattedData?.length || !originalTime) return;

    const targetMs = parseOriginalTimeMs(originalTime);
    const nearestBar = findNearestBarByMs(formattedData, targetMs);
    if (!nearestBar) return;

    goToBarIndex(nearestBar.originalIndex);
  };

  const syncCrosshairFromBar = (source, sourceBar, sourcePrice = null) => {
    if (!sourceBar || !hasSecondaryPaneRef.current || isSyncingCrosshairRef.current) return;

    const targetData = source === 'primary'
      ? secondaryFormattedDataRef.current
      : primaryFormattedDataRef.current;
    const targetChart = source === 'primary'
      ? secondaryChartRef.current
      : chartRef.current;
    const targetSeries = source === 'primary'
      ? secondaryCandlestickSeriesRef.current
      : candlestickSeriesRef.current;
    if (!targetData?.length || !targetChart || !targetSeries) return;

    const targetBar = findNearestBarByMs(targetData, sourceBar.timeMs);
    if (!targetBar) return;

    const targetPrice = Number.isFinite(sourcePrice) ? sourcePrice : targetBar.close;
    isSyncingCrosshairRef.current = true;
    targetChart.setCrosshairPosition(targetPrice, targetBar.time, targetSeries);
    requestAnimationFrame(() => {
      isSyncingCrosshairRef.current = false;
    });
  };

  const clearSyncedCrosshair = (source) => {
    if (isSyncingCrosshairRef.current || !hasSecondaryPaneRef.current) return;
    const targetChart = source === 'primary' ? secondaryChartRef.current : chartRef.current;
    targetChart?.clearCrosshairPosition();
  };

  const getNearestSourceBarFromCoordinate = (source, x) => {
    const chart = source === 'primary' ? chartRef.current : secondaryChartRef.current;
    const formattedData = source === 'primary'
      ? primaryFormattedDataRef.current
      : secondaryFormattedDataRef.current;
    if (!chart || !formattedData?.length) return null;

    const logicalIndex = chart.timeScale().coordinateToLogical(x);
    if (logicalIndex === null) return null;

    const barIndex = Math.max(0, Math.min(formattedData.length - 1, Math.round(logicalIndex)));
    return formattedData[barIndex] || null;
  };

  const getVisiblePriceRange = (source) => {
    const chart = source === 'primary' ? chartRef.current : secondaryChartRef.current;
    const formattedData = source === 'primary'
      ? primaryFormattedDataRef.current
      : secondaryFormattedDataRef.current;
    const scaleRange = chart?.priceScale('right').getVisibleRange();
    if (scaleRange && Number.isFinite(scaleRange.from) && Number.isFinite(scaleRange.to) && scaleRange.to > scaleRange.from) {
      return scaleRange;
    }

    const logicalRange = chart?.timeScale().getVisibleLogicalRange();
    if (!logicalRange || !formattedData?.length) return null;
    const start = Math.max(0, Math.floor(logicalRange.from));
    const end = Math.min(formattedData.length - 1, Math.ceil(logicalRange.to));
    const visibleData = formattedData.slice(start, end + 1);
    const values = visibleData.flatMap(item => [
      item.high,
      item.low,
      item.ema,
      item.ema5,
      item.ema10,
      item.ma1,
      item.ma2,
    ]).filter(Number.isFinite);
    if (values.length === 0) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.12, 0.5);
    return { from: min - padding, to: max + padding };
  };

  const handleVerticalWheelZoom = (source, event) => {
    if (!event.ctrlKey) return;
    const chart = source === 'primary' ? chartRef.current : secondaryChartRef.current;
    const series = source === 'primary' ? candlestickSeriesRef.current : secondaryCandlestickSeriesRef.current;
    const container = source === 'primary' ? chartContainerRef.current : secondaryChartContainerRef.current;
    if (!chart || !series || !container) return;

    event.preventDefault();
    event.stopPropagation();

    const range = getVisiblePriceRange(source);
    if (!range) return;

    const rect = container.getBoundingClientRect();
    const cursorPrice = series.coordinateToPrice(event.clientY - rect.top);
    const anchor = Number.isFinite(cursorPrice) ? cursorPrice : (range.from + range.to) / 2;
    const factor = event.deltaY < 0 ? 0.82 : 1.22;
    const nextFrom = anchor - (anchor - range.from) * factor;
    const nextTo = anchor + (range.to - anchor) * factor;
    const minSpan = source === 'primary' ? 1 : 0.5;
    if (nextTo - nextFrom < minSpan) return;

    chart.priceScale('right').setVisibleRange({
      from: nextFrom,
      to: nextTo,
    });
  };

  const mapSelectionBar = (bar) => ({
    barIndex: bar.originalIndex,
    time: bar.originalTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    ma1: bar.ma1,
    ma2: bar.ma2,
  });

  const updateHaSelectionOverlay = (selection = haSelectionRef.current) => {
    const chart = secondaryChartRef.current;
    const el = haSelectionHighlightRef.current;
    if (!el) return;

    if (!chart || !selection) {
      el.style.display = 'none';
      return;
    }

    const startX = chart.timeScale().timeToCoordinate(selection.startChartTime);
    const endX = chart.timeScale().timeToCoordinate(selection.endChartTime);
    if (startX === null || endX === null) {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';
    el.style.left = `${Math.min(startX, endX)}px`;
    el.style.width = `${Math.max(3, Math.abs(endX - startX))}px`;
  };

  const clearHaSelection = () => {
    haSelectionRef.current = null;
    setHaSelection(null);
    updateHaSelectionOverlay(null);
    onHaSelectionChange?.(null);
  };

  const createHaSelection = (startBar, endBar) => {
    const formattedData = secondaryFormattedDataRef.current;
    if (!startBar || !endBar || !formattedData?.length) return null;

    const startIndex = Math.min(startBar.originalIndex, endBar.originalIndex);
    const endIndex = Math.max(startBar.originalIndex, endBar.originalIndex);
    const selectedBars = formattedData.slice(startIndex, endIndex + 1);
    if (selectedBars.length === 0) return null;

    const startTime = selectedBars[0].originalTime;
    const endTime = selectedBars[selectedBars.length - 1].originalTime;
    const startMs = parseOriginalTimeMs(startTime);
    const endMs = parseOriginalTimeMs(endTime);
    const linkedMesBars = primaryFormattedDataRef.current
      .filter(bar => {
        const barMs = parseOriginalTimeMs(bar.originalTime);
        return barMs >= startMs && barMs <= endMs;
      })
      .map(bar => ({
        barIndex: bar.originalIndex,
        time: bar.originalTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        ema: bar.ema,
        ema5: bar.ema5,
        ema10: bar.ema10,
      }));

    const highs = selectedBars.map(bar => bar.high).filter(Number.isFinite);
    const lows = selectedBars.map(bar => bar.low).filter(Number.isFinite);
    const first = selectedBars[0];
    const last = selectedBars[selectedBars.length - 1];

    return {
      source: 'heiken_ashi',
      startTime,
      endTime,
      startChartTime: first.time,
      endChartTime: last.time,
      startBarIndex: startIndex,
      endBarIndex: endIndex,
      barCount: selectedBars.length,
      linkedMesBarCount: linkedMesBars.length,
      high: highs.length ? Math.max(...highs) : null,
      low: lows.length ? Math.min(...lows) : null,
      open: first.open,
      close: last.close,
      ma1Start: first.ma1,
      ma1End: last.ma1,
      ma2Start: first.ma2,
      ma2End: last.ma2,
      bars: selectedBars.map(mapSelectionBar),
      linkedMesBars,
    };
  };

  const applyHaSelection = (selection) => {
    haSelectionRef.current = selection;
    setHaSelection(selection);
    updateHaSelectionOverlay(selection);
    onHaSelectionChange?.(selection);
  };

  const previewHaSelection = (selection) => {
    haSelectionRef.current = selection;
    setHaSelection(selection);
    updateHaSelectionOverlay(selection);
  };

  const startHaSelectionDrag = (event) => {
    if (!haSelectionModeRef.current || !secondaryChartContainerRef.current) return false;
    if (event.button !== 0) return false;

    const rect = secondaryChartContainerRef.current.getBoundingClientRect();
    const startBar = getNearestSourceBarFromCoordinate('secondary', event.clientX - rect.left);
    if (!startBar) return false;

    event.preventDefault();
    event.stopPropagation();
    cancelLongPressSync();
    haSelectionDragRef.current = { startBar, latestSelection: createHaSelection(startBar, startBar) };
    previewHaSelection(haSelectionDragRef.current.latestSelection);

    const handleMouseMove = (moveEvent) => {
      const currentBar = getNearestSourceBarFromCoordinate('secondary', moveEvent.clientX - rect.left);
      if (!currentBar || !haSelectionDragRef.current) return;

      const selection = createHaSelection(haSelectionDragRef.current.startBar, currentBar);
      if (!selection) return;
      haSelectionDragRef.current.latestSelection = selection;
      previewHaSelection(selection);
    };

    const handleMouseUp = () => {
      const finalSelection = haSelectionDragRef.current?.latestSelection;
      haSelectionDragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      if (finalSelection) applyHaSelection(finalSelection);
      haSelectionModeRef.current = false;
      setHaSelectionMode(false);
    };

    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    return true;
  };

  const startLongPressSync = (source, event) => {
    if (!hasSecondaryPaneRef.current) return;
    const container = source === 'primary' ? chartContainerRef.current : secondaryChartContainerRef.current;
    if (!container) return;

    window.clearTimeout(longPressTimerRef.current);
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = true;
      const sourceBar = getNearestSourceBarFromCoordinate(source, x);
      if (!sourceBar) return;

      if (source === 'primary') {
        centerSecondaryPaneOnTime(sourceBar.originalTime);
      } else {
        // Do not automatically recenter the primary chart when interacting with the secondary chart
      }
      syncCrosshairFromBar(source, sourceBar);
    }, 450);
  };

  const cancelLongPressSync = () => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const handleSplitterMouseDown = (event) => {
    if (!hasSecondaryPane || !panesContainerRef.current) return;
    event.preventDefault();

    const handleMouseMove = (moveEvent) => {
      const rect = panesContainerRef.current?.getBoundingClientRect();
      if (!rect || rect.height <= 0) return;

      const secondaryHeight = rect.bottom - moveEvent.clientY;
      const nextPercent = Math.max(18, Math.min(55, (secondaryHeight / rect.height) * 100));
      setSecondaryPanePercent(nextPercent);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    const chartWidth = chartContainerRef.current?.clientWidth || 0;
    const chartHeight = chartContainerRef.current?.clientHeight || 0;
    if (chartWidth > 0 && chartHeight > 0) {
      chartRef.current?.resize(chartWidth, chartHeight);
    }

    const secondaryWidth = secondaryChartContainerRef.current?.clientWidth || 0;
    const secondaryHeight = secondaryChartContainerRef.current?.clientHeight || 0;
    if (secondaryWidth > 0 && secondaryHeight > 0) {
      secondaryChartRef.current?.resize(secondaryWidth, secondaryHeight);
    }
  }, [secondaryPanePercent, hasSecondaryPane]);

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    // Lightweight Charts requires unique ascending times. Keep those internal
    // chart keys separate from the original MultiCharts completion timestamps.
    const { formattedData, originalTimeByChartTime, barIndexByChartTime } = formatChartData(data);
    primaryFormattedDataRef.current = formattedData;
    primaryBarByChartTimeRef.current = new Map(formattedData.map(item => [item.time, item]));

    // (50 EMA calculation removed)

    const inferredBrickSize = inferBrickSize(data);

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
        mode: 0, // Normal crosshair: follow the mouse freely instead of snapping to bars/prices
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
          const date = getOriginalDateForChartTime(time, originalTimeByChartTime);
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
              return formatOriginalChartTime(time, originalTimeByChartTime);
            default:
              return '';
          }
        },
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (timestamp) => formatOriginalChartTime(timestamp, originalTimeByChartTime, true),
      },
    });

    chartRef.current = chart;

    const initialPriceWindow = formattedData.slice(-150);
    const initialMinPrice = Math.min(...initialPriceWindow.flatMap(item => [
      item.low,
      item.ema5 ?? item.ema ?? item.low,
      item.ema10 ?? item.low,
    ]));
    const initialMaxPrice = Math.max(...initialPriceWindow.flatMap(item => [
      item.high,
      item.ema5 ?? item.ema ?? item.high,
      item.ema10 ?? item.high,
    ]));
    const minimumVisibleBricks = 18;
    const lockedPriceSpan = Math.max(inferredBrickSize * minimumVisibleBricks, initialMaxPrice - initialMinPrice);
    const constantPriceSpan = original => {
      const autoscaleInfo = original();
      if (!autoscaleInfo) return null;

      const center = (
        autoscaleInfo.priceRange.minValue +
        autoscaleInfo.priceRange.maxValue
      ) / 2;
      return {
        ...autoscaleInfo,
        priceRange: {
          minValue: center - lockedPriceSpan / 2,
          maxValue: center + lockedPriceSpan / 2,
        },
      };
    };

    // Add Candlestick Series (for Renko Bricks + Wicks, or standard wicks/borders if regular)
    const candlestickSeriesOptions = isRegularCandlestick ? {
      upColor: '#004cff',
      downColor: '#cc1a1a',
      borderVisible: true,
      borderColor: '#000000',
      borderUpColor: '#000000',
      borderDownColor: '#000000',
      wickVisible: true,
      wickUpColor: '#000000',
      wickDownColor: '#000000',
    } : {
      upColor: 'rgba(0, 0, 0, 0)',
      downColor: 'rgba(0, 0, 0, 0)',
      borderVisible: false,
      wickVisible: false,      // Hide default 1px wicks (our custom primitive draws thick wicks)
      autoscaleInfoProvider: constantPriceSpan,
    };
    const candlestickSeries = chart.addSeries(CandlestickSeries, candlestickSeriesOptions);
    candlestickSeriesRef.current = candlestickSeries;

    // Add Line Series (5 EMA yellow, 10 EMA green to match MultiCharts)
    const ema5Series = chart.addSeries(LineSeries, {
      color: '#ffd400',
      lineWidth: 2,
      priceLineVisible: false,
      autoscaleInfoProvider: () => null,
    });
    ema5SeriesRef.current = ema5Series;

    const ema10Series = chart.addSeries(LineSeries, {
      color: '#008000',
      lineWidth: 2,
      priceLineVisible: false,
      autoscaleInfoProvider: () => null,
    });
    ema10SeriesRef.current = ema10Series;

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

    // Attach custom bold wicks and 15pt grid overlay primitive (only for Renko charts)
    if (!isRegularCandlestick) {
      const renkoOverlay = new RenkoOverlayPrimitive(formattedData, {
        wickWidth: 3, // 3 pixels wide
        wickColor: '#000000',
        bodyBorderWidth: 1,
        bodyBorderColor: '#000000',
        upColor: '#004cff',
        downColor: '#cc1a1a',
        brickSize: inferredBrickSize,
        gridColor: 'rgba(0, 0, 0, 0.18)',
      });
      candlestickSeries.attachPrimitive(renkoOverlay);
      renkoOverlayRef.current = renkoOverlay;
    }
    candlestickSeries.attachPrimitive(new SessionDividerPrimitive(sessionOpenTimes, {
      color: '#363636',
      lineWidth: 2,
    }));

    // Populate EMA Series
    const ema5Data = formattedData
      .filter(d => (d.ema5 ?? d.ema) !== undefined && (d.ema5 ?? d.ema) !== null)
      .map(d => ({
        time: d.time,
        value: d.ema5 ?? d.ema,
      }));
    ema5Series.setData(ema5Data);

    const ema10Data = formattedData
      .filter(d => d.ema10 !== undefined && d.ema10 !== null)
      .map(d => ({
        time: d.time,
        value: d.ema10,
      }));
    ema10Series.setData(ema10Data);

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
      if (!param?.time) {
        clearSyncedCrosshair('primary');
        return;
      }
      const barIndex = barIndexByChartTime.get(param.time);
      if (Number.isInteger(barIndex)) crosshairBarIndexRef.current = barIndex;
      if (!isSyncingCrosshairRef.current) {
        const sourcePrice = Number.isFinite(param.point?.y)
          ? candlestickSeriesRef.current?.coordinateToPrice(param.point.y)
          : null;
        syncCrosshairFromBar('primary', primaryBarByChartTimeRef.current.get(param.time), sourcePrice);
      }
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
    const handlePrimaryMouseDown = (event) => {
      if (event.button === 0) startLongPressSync('primary', event);
    };
    const handlePrimaryWheel = (event) => handleVerticalWheelZoom('primary', event);
    chartContainerRef.current.addEventListener('mousedown', handlePrimaryMouseDown, true);
    chartContainerRef.current.addEventListener('mouseup', cancelLongPressSync, true);
    chartContainerRef.current.addEventListener('mouseleave', cancelLongPressSync, true);
    chartContainerRef.current.addEventListener('wheel', handlePrimaryWheel, { passive: false });

    // Handle Clicks for Annotation Placement (only on the actual bar)
    chart.subscribeClick((param) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (!param?.point) return;

      const logicalIndex = chart.timeScale().coordinateToLogical(param.point.x);
      const barIndex = logicalIndex === null ? -1 : Math.round(logicalIndex);
      const clickedBrick = formattedData[barIndex];
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
      chartContainerRef.current?.removeEventListener('mousedown', handlePrimaryMouseDown, true);
      chartContainerRef.current?.removeEventListener('mouseup', cancelLongPressSync, true);
      chartContainerRef.current?.removeEventListener('mouseleave', cancelLongPressSync, true);
      chartContainerRef.current?.removeEventListener('wheel', handlePrimaryWheel);
      chart.remove();
      markersPluginRef.current = null;
      renkoOverlayRef.current = null;
      primaryFormattedDataRef.current = [];
      primaryBarByChartTimeRef.current = new Map();
    };
  }, [data]);

  useEffect(() => {
    if (!secondaryChartContainerRef.current || !secondaryData || secondaryData.length === 0 || !hasSecondaryPane) {
      secondaryFormattedDataRef.current = [];
      return;
    }

    const { formattedData, originalTimeByChartTime } = formatChartData(secondaryData);
    secondaryFormattedDataRef.current = formattedData;
    secondaryBarByChartTimeRef.current = new Map(formattedData.map(item => [item.time, item]));

    const chart = createChart(secondaryChartContainerRef.current, {
      width: secondaryChartContainerRef.current.clientWidth,
      height: secondaryChartContainerRef.current.clientHeight,
      layout: {
        background: { color: '#9c9c9c' },
        textColor: '#000000',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(0, 0, 0, 0.08)' },
        horzLines: { color: 'rgba(0, 0, 0, 0.08)' },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: '#334155',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: '#334155',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(0, 0, 0, 0.15)',
        scaleMargins: {
          top: 0.12,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderColor: 'rgba(0, 0, 0, 0.15)',
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 4,
        tickMarkFormatter: (time, tickMarkType) => {
          const date = getOriginalDateForChartTime(time, originalTimeByChartTime);
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          switch (tickMarkType) {
            case 0:
              return String(date.getUTCFullYear());
            case 1:
              return MONTHS[date.getUTCMonth()];
            case 2:
              return String(date.getUTCDate());
            case 3:
            case 4:
              return formatOriginalChartTime(time, originalTimeByChartTime);
            default:
              return '';
          }
        },
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (timestamp) => formatOriginalChartTime(timestamp, originalTimeByChartTime, true),
      },
    });

    secondaryChartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#004cff',
      downColor: '#cc1a1a',
      borderUpColor: '#000000',
      borderDownColor: '#000000',
      wickUpColor: '#000000',
      wickDownColor: '#000000',
      priceLineVisible: false,
    });
    secondaryCandlestickSeriesRef.current = candleSeries;
    candleSeries.setData(formattedData.map(item => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    })));

    const ma1Series = chart.addSeries(LineSeries, {
      color: '#ffd400',
      lineWidth: 2,
      priceLineVisible: false,
    });
    secondaryMa1SeriesRef.current = ma1Series;
    ma1Series.setData(formattedData
      .filter(item => Number.isFinite(item.ma1))
      .map(item => ({ time: item.time, value: item.ma1 })));

    const ma2Series = chart.addSeries(LineSeries, {
      color: '#008000',
      lineWidth: 2,
      priceLineVisible: false,
    });
    secondaryMa2SeriesRef.current = ma2Series;
    ma2Series.setData(formattedData
      .filter(item => Number.isFinite(item.ma2))
      .map(item => ({ time: item.time, value: item.ma2 })));

    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, formattedData.length - 180),
      to: formattedData.length,
    });

    const handleSecondaryVisibleRangeChange = () => {
      updateHaSelectionOverlay();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleSecondaryVisibleRangeChange);

    chart.subscribeCrosshairMove((param) => {
      if (!param?.time) {
        clearSyncedCrosshair('secondary');
        return;
      }
      if (!isSyncingCrosshairRef.current) {
        const sourcePrice = Number.isFinite(param.point?.y)
          ? secondaryCandlestickSeriesRef.current?.coordinateToPrice(param.point.y)
          : null;
        syncCrosshairFromBar('secondary', secondaryBarByChartTimeRef.current.get(param.time), sourcePrice);
      }
    });

    const handleSecondaryMouseDown = (event) => {
      if (startHaSelectionDrag(event)) return;
      if (event.button === 0) startLongPressSync('secondary', event);
    };
    const handleSecondaryWheel = (event) => handleVerticalWheelZoom('secondary', event);
    secondaryChartContainerRef.current.addEventListener('mousedown', handleSecondaryMouseDown, true);
    secondaryChartContainerRef.current.addEventListener('mouseup', cancelLongPressSync, true);
    secondaryChartContainerRef.current.addEventListener('mouseleave', cancelLongPressSync, true);
    secondaryChartContainerRef.current.addEventListener('wheel', handleSecondaryWheel, { passive: false });

    const handleResize = () => {
      if (secondaryChartContainerRef.current) {
        chart.resize(
          secondaryChartContainerRef.current.clientWidth,
          secondaryChartContainerRef.current.clientHeight
        );
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleSecondaryVisibleRangeChange);
      secondaryChartContainerRef.current?.removeEventListener('mousedown', handleSecondaryMouseDown, true);
      secondaryChartContainerRef.current?.removeEventListener('mouseup', cancelLongPressSync, true);
      secondaryChartContainerRef.current?.removeEventListener('mouseleave', cancelLongPressSync, true);
      secondaryChartContainerRef.current?.removeEventListener('wheel', handleSecondaryWheel);
      chart.remove();
      secondaryChartRef.current = null;
      secondaryCandlestickSeriesRef.current = null;
      secondaryMa1SeriesRef.current = null;
      secondaryMa2SeriesRef.current = null;
      secondaryFormattedDataRef.current = [];
      secondaryBarByChartTimeRef.current = new Map();
    };
  }, [secondaryData, hasSecondaryPane]);

  useEffect(() => {
    const virtualBricks = (annotations || [])
      .filter(annotation =>
        annotation.signalSet === 3 &&
        annotation.setupType === 'synthetic' &&
        Number.isInteger(annotation.entryBarIndex) &&
        Number.isFinite(annotation.virtualBrick?.open) &&
        Number.isFinite(annotation.virtualBrick?.close)
      )
      .map(annotation => ({
        barIndex: annotation.entryBarIndex,
        action: annotation.action,
        open: annotation.virtualBrick.open,
        close: annotation.virtualBrick.close,
        label: '',
      }));
    const aridELabels = [];
    const teachLabels = [];
    renkoOverlayRef.current?.updateVirtualBricks(virtualBricks);
    renkoOverlayRef.current?.updateAridELabels(aridELabels);
    renkoOverlayRef.current?.updateTeachLabels(teachLabels);
  }, [annotations, data]);

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
          if (ann.isYellowMomentumCampaignEntry) {
            markers.push({
              time: chartTime,
              position: ann.action === 'Buy' ? 'belowBar' : 'aboveBar',
              color: '#eab308',
              shape: ann.action === 'Buy' ? 'arrowUp' : 'arrowDown',
              text: '',
            });
          } else if (ann.isYellowMomentumCampaignExit) {
            const profit = Number(ann.profitBricks);
            markers.push({
              time: chartTime,
              position: ann.direction === 'Buy' ? 'aboveBar' : 'belowBar',
              color: Number.isFinite(profit) && profit >= 0 ? '#22c55e' : '#ef4444',
              shape: 'square',
              text: '',
            });
          } else if (ann.isEmaBounceCampaignEntry) {
            markers.push({
              time: chartTime,
              position: ann.action === 'Buy' ? 'belowBar' : 'aboveBar',
              color: ann.action === 'Buy' ? '#06b6d4' : '#f97316',
              shape: ann.action === 'Buy' ? 'arrowUp' : 'arrowDown',
              text: '',
            });
          } else if (ann.isEmaBounceCampaignExit) {
            const profit = Number(ann.profitBricks);
            markers.push({
              time: chartTime,
              position: ann.direction === 'Buy' ? 'aboveBar' : 'belowBar',
              color: Number.isFinite(profit) && profit >= 0 ? '#16a34a' : '#dc2626',
              shape: 'square',
              text: '',
            });
          } else if (ann.isMesReg5RecoveryCampaignEntry) {
            markers.push({
              time: chartTime,
              position: ann.action === 'Buy' ? 'belowBar' : 'aboveBar',
              color: '#000000',
              shape: ann.action === 'Buy' ? 'arrowUp' : 'arrowDown',
              size: 3,
              text: '',
            });
          } else if (ann.isMesReg5RecoveryCampaignExit) {
            const profit = Number(ann.profitBricks);
            markers.push({
              time: chartTime,
              position: ann.direction === 'Buy' ? 'aboveBar' : 'belowBar',
              color: Number.isFinite(profit) && profit >= 0 ? '#f59e0b' : '#f43f5e',
              shape: 'square',
              size: 3,
              text: Number.isFinite(profit) && profit >= 0 ? 'DONE' : 'EXIT',
            });
          } else if (ann.isCampaignEntry) {
            markers.push({
              time: chartTime,
              position: ann.action === 'Buy' ? 'belowBar' : 'aboveBar',
              color: ann.action === 'Buy' ? '#1d4ed8' : '#a21caf', // Dark Royal Blue for Buy, Dark Magenta for Sell
              shape: ann.action === 'Buy' ? 'arrowUp' : 'arrowDown',
              text: '',
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
              text: '',
            });
          } else if (ann.markerSet === 'Raw Range Bar Set' && ann.action === 'Buy') {
            markers.push({
              time: chartTime,
              position: 'belowBar',
              color: '#0057ff',
              shape: 'arrowUp',
              text: '',
            });
          } else if (ann.markerSet === 'Raw Range Bar Set' && ann.action === 'Sell') {
            markers.push({
              time: chartTime,
              position: 'aboveBar',
              color: '#b00020',
              shape: 'arrowDown',
              text: '',
            });
          } else if (ann.action === 'Buy') {
            if (ann.signalSet === 6) {
              markers.push({
                time: chartTime,
                position: 'belowBar',
                color: '#0f766e',
                shape: 'arrowUp',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 5) {
              markers.push({
                time: chartTime,
                position: 'belowBar',
                color: '#f59e0b',
                shape: 'arrowUp',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 7) {
              markers.push({
                time: chartTime,
                position: 'belowBar',
                color: '#7c3aed',
                shape: 'arrowUp',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 8) {
              markers.push({
                time: chartTime,
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 3) {
              if (ann.setupType === 'synthetic') return;
              markers.push({
                time: chartTime,
                position: 'belowBar',
                color: '#004cff',
                shape: 'arrowUp',
                text: '',
              });
              return;
            }

            markers.push({
              time: chartTime,
              position: 'belowBar',
              color: '#004cff', // Pure Up-bar hue for shape
              shape: 'arrowUp',
              text: '', // No text for generated signal or built-in TEACH marker
            });
          } else if (ann.action === 'Sell') {
            if (ann.signalSet === 6) {
              markers.push({
                time: chartTime,
                position: 'aboveBar',
                color: '#0f766e',
                shape: 'arrowDown',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 5) {
              markers.push({
                time: chartTime,
                position: 'aboveBar',
                color: '#f59e0b',
                shape: 'arrowDown',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 7) {
              markers.push({
                time: chartTime,
                position: 'aboveBar',
                color: '#7c3aed',
                shape: 'arrowDown',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 8) {
              markers.push({
                time: chartTime,
                position: 'aboveBar',
                color: '#10b981',
                shape: 'arrowDown',
                text: '',
              });
              return;
            }
            if (ann.signalSet === 3) {
              if (ann.setupType === 'synthetic') return;
              markers.push({
                time: chartTime,
                position: 'aboveBar',
                color: '#cc1a1a',
                shape: 'arrowDown',
                text: '',
              });
              return;
            }

            markers.push({
              time: chartTime,
              position: 'aboveBar',
              color: '#cc1a1a', // Pure Down-bar hue for shape
              shape: 'arrowDown',
              text: '', // No text for generated signal or built-in TEACH marker
            });
          } else if (ann.action === 'Skip') {
            markers.push({
              time: chartTime,
              position: 'aboveBar',
              color: '#000000', // Black shape
              shape: 'circle',
              text: '', // No text for built-in TEACH marker
            });
          }
        }
      });
    }

    markers.sort((a, b) => a.time - b.time);

    const finalMarkers = markers.map(m => {
      if (m.shape === 'arrowUp' || m.shape === 'arrowDown') {
        return { ...m, color: '#000000' };
      }
      return m;
    });

    if (!markersPluginRef.current) {
      markersPluginRef.current = createSeriesMarkers(candlestickSeriesRef.current, finalMarkers);
    } else {
      markersPluginRef.current.setMarkers(finalMarkers);
    }
  }, [annotations, data]);

  return (
    <div className="chart-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={panesContainerRef}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div
          ref={chartContainerRef}
          style={{
            flex: hasSecondaryPane ? `1 1 ${100 - secondaryPanePercent}%` : '1 1 auto',
            minHeight: hasSecondaryPane ? '260px' : 0,
          }}
        />
        {hasSecondaryPane && (
          <>
            <div
              className="chart-splitter"
              onMouseDown={handleSplitterMouseDown}
              title="Drag to resize Renko and Heiken Ashi panes"
            />
            <div
              style={{
                flex: `0 0 ${secondaryPanePercent}%`,
                minHeight: '150px',
                background: '#9c9c9c',
                position: 'relative',
              }}
            >
              <div ref={secondaryChartContainerRef} style={{ width: '100%', height: '100%' }} />
              <div
                ref={haSelectionHighlightRef}
                className="ha-selection-highlight"
                style={{ display: 'none' }}
              />
              <div className="ha-pane-toolbar" style={{ display: 'flex', width: 'calc(100% - 24px)', alignItems: 'center' }}>
                <span>MES 2s Heiken Ashi · MA1 10 EMA · MA2 60 SMA</span>
                {haSelection && (
                  <span className="ha-selection-summary">
                    {formatSelectionTime(haSelection.startTime)}-{formatSelectionTime(haSelection.endTime)} · {haSelection.barCount} bars
                  </span>
                )}
                <button
                  type="button"
                  className={`ha-selection-button ${haSelectionMode ? 'active' : ''}`}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={() => setHaSelectionMode(enabled => !enabled)}
                >
                  {haSelectionMode ? 'Selecting' : 'Select Range'}
                </button>
                {haSelection && (
                  <button
                    type="button"
                    className="ha-selection-button"
                    onMouseDown={event => event.stopPropagation()}
                    onClick={clearHaSelection}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="ha-selection-button"
                  title="Close Heiken Ashi Pane"
                  style={{
                    marginLeft: 'auto',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '700',
                    color: '#ff1744',
                    padding: '2px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={() => onToggleSecondaryPane?.(false)}
                >
                  ✕
                </button>
              </div>
            </div>
          </>
        )}
      </div>
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
