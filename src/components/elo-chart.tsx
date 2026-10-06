"use client";

import { useEffect, useRef } from "react";
import type { HistoryPoint } from "@/lib/storage";

export interface ChartLine {
  name: string;
  color: string;
  value: (point: HistoryPoint) => number;
}

export function LineChart({
  points,
  lines,
  empty,
}: {
  points: HistoryPoint[];
  lines: ChartLine[];
  empty: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || points.length === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      for (const line of lines) {
        const value = line.value(point);
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (max - min < 8) {
      const mid = (max + min) / 2;
      min = mid - 8;
      max = mid + 8;
    } else {
      const pad = (max - min) * 0.08;
      min -= pad;
      max += pad;
    }

    const left = 46;
    const right = 12;
    const top = 12;
    const bottom = 22;
    const plotW = width - left - right;
    const plotH = height - top - bottom;

    context.strokeStyle = "rgba(243,230,208,0.16)";
    context.lineWidth = 1;
    context.font = "11px 'Source Sans 3', sans-serif";
    context.fillStyle = "#c4b39a";
    for (let i = 0; i < 4; i++) {
      const y = top + (plotH * i) / 3;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      const label = Math.round(max - ((max - min) * i) / 3);
      context.fillText(String(label), 4, y + 4);
    }

    const xAt = (index: number) =>
      points.length === 1 ? left + plotW / 2 : left + (plotW * index) / (points.length - 1);
    const yAt = (value: number) => top + ((max - value) / (max - min)) * plotH;

    for (const line of lines) {
      context.beginPath();
      context.strokeStyle = line.color;
      context.lineWidth = line.name === "Kaiji" ? 2.5 : 1.4;
      points.forEach((point, index) => {
        const x = xAt(index);
        const y = yAt(line.value(point));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      if (points.length === 1) {
        const point = points[0];
        context.fillStyle = line.color;
        context.beginPath();
        context.arc(xAt(0), yAt(line.value(point)), 3, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.fillStyle = "#c4b39a";
    context.fillText("1", left, height - 6);
    const last = String(points.length);
    context.fillText(last, width - right - context.measureText(last).width, height - 6);
  }, [points, lines]);

  if (points.length === 0) {
    return <p className="text-sm leading-relaxed text-muted-foreground">{empty}</p>;
  }

  return (
    <div>
      <canvas ref={ref} className="h-56 w-full" />
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {lines.map((line) => (
          <li key={line.name} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5" style={{ background: line.color }} />
            {line.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
