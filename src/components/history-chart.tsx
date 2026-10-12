"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/lib/format";

/** Series colors validated against the dark surface (lightness band, contrast, CVD). */
export const SERIES_COLOR = { SOL: "#2fa866", USDC: "#5583d2" } as const;

export interface HistoryPoint {
  t: number;
  value: number;
}

/** Single-series history chart (one asset per chart; never a dual axis). */
export function HistoryChart({ points, asset }: { points: HistoryPoint[]; asset: "SOL" | "USDC" }) {
  return (
    <div className="h-44 w-full" role="img" aria-label={`${asset} held in tracked positions over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1e262c" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            stroke="#5d6a72"
            tick={{ fontSize: 11, fill: "#8b979f" }}
            tickLine={false}
            axisLine={{ stroke: "#2b363e" }}
            minTickGap={40}
          />
          <YAxis
            width={56}
            stroke="#5d6a72"
            tick={{ fontSize: 11, fill: "#8b979f" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatAmount(v, 2)}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "#5d6a72", strokeWidth: 1 }}
            contentStyle={{ background: "#12171b", border: "1px solid #2b363e", borderRadius: 8, fontSize: 12, color: "#e7ecef" }}
            labelStyle={{ color: "#8b979f" }}
            itemStyle={{ color: "#e7ecef" }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v) => [`${formatAmount(Number(v), 6)} ${asset}`, "In positions"]}
          />
          <Line type="monotone" dataKey="value" stroke={SERIES_COLOR[asset]} strokeWidth={2} dot={points.length < 20 ? { r: 3, strokeWidth: 0, fill: SERIES_COLOR[asset] } : false} activeDot={{ r: 5, stroke: "#0d1114", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
