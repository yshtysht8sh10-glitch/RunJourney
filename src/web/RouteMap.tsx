import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { RunRecord } from "../types/run";
import "leaflet/dist/leaflet.css";

export default function RouteMap({
  run,
  selectedIndex,
}: {
  run: RunRecord;
  selectedIndex?: number;
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null),
    selected = useRef<Leaflet.CircleMarker | null>(null);
  const [tiles, setTiles] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void import("leaflet")
      .then((L) => {
        if (disposed || !element.current) return;
        const valid = run.points.filter(
          (p) =>
            Number.isFinite(p.latitude) &&
            Math.abs(p.latitude) <= 90 &&
            Number.isFinite(p.longitude) &&
            Math.abs(p.longitude) <= 180,
        );
        const instance = L.map(element.current, {
          center: [34.975, 138.383],
          zoom: 13,
        });
        map.current = instance;
        if (tiles)
          L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          }).addTo(instance);
        // Split on invalid points, reversed clocks, gaps and antimeridian crossings.
        let segment: Leaflet.LatLngTuple[] = [];
        const flush = () => {
          if (segment.length > 1)
            L.polyline(segment, { color: "#e76e42", weight: 4 }).addTo(
              instance,
            );
          segment = [];
        };
        run.points.forEach((p, i) => {
          if (
            !Number.isFinite(p.latitude) ||
            Math.abs(p.latitude) > 90 ||
            !Number.isFinite(p.longitude) ||
            Math.abs(p.longitude) > 180
          ) {
            flush();
            return;
          }
          const prior = run.points[i - 1];
          if (
            prior &&
            (p.timestamp - prior.timestamp > 60000 ||
              p.timestamp <= prior.timestamp ||
              Math.abs(p.longitude - prior.longitude) > 180)
          )
            flush();
          segment.push([p.latitude, p.longitude]);
        });
        flush();
        if (valid.length) {
          const start = valid[0],
            end = valid.at(-1)!;
          L.circleMarker([start.latitude, start.longitude], {
            color: "#4ad6b0",
            radius: 8,
          })
            .addTo(instance)
            .bindTooltip("START");
          L.circleMarker([end.latitude, end.longitude], {
            color: "#f0d174",
            radius: 5,
          })
            .addTo(instance)
            .bindTooltip("STOP");
          const bounds = L.latLngBounds(
            valid.map((p) => [p.latitude, p.longitude] as Leaflet.LatLngTuple),
          );
          instance.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
        }
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      selected.current = null;
    };
  }, [run, tiles]);
  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed) return;
      selected.current?.remove();
      selected.current = null;
      const p =
        selectedIndex === undefined ? undefined : run.points[selectedIndex];
      if (
        map.current &&
        p &&
        Number.isFinite(p.latitude) &&
        Math.abs(p.latitude) <= 90 &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.longitude) <= 180
      )
        selected.current = L.circleMarker([p.latitude, p.longitude], {
          color: "#fff",
          radius: 9,
          fillColor: "#389eff",
          fillOpacity: 1,
        })
          .addTo(map.current)
          .bindTooltip(`GPS #${selectedIndex}`)
          .openTooltip();
    });
    return () => {
      disposed = true;
    };
  }, [run, selectedIndex, tiles]);
  return (
    <>
      <div className="map-tools">
        <span>START ● → STOP ● · 保存GPS {run.points.length}点</span>
        <button onClick={() => setTiles((v) => !v)}>
          {tiles ? "背景地図をOFF" : "背景地図を読み込む"}
        </button>
        <button
          onClick={() => {
            const points = run.points.filter(
              (p) =>
                Number.isFinite(p.latitude) &&
                Math.abs(p.latitude) <= 90 &&
                Number.isFinite(p.longitude) &&
                Math.abs(p.longitude) <= 180,
            );
            void import("leaflet").then((L) => {
              if (points.length)
                map.current?.fitBounds(
                  L.latLngBounds(
                    points.map(
                      (p) => [p.latitude, p.longitude] as Leaflet.LatLngTuple,
                    ),
                  ),
                  { padding: [30, 30], maxZoom: 17 },
                );
            });
          }}
        >
          全軌跡へ
        </button>
      </div>
      <div ref={element} className="route-map" aria-label="保存GPSの軌跡地図" />
      {!tiles && (
        <small>
          座標グリッド表示中。背景地図をONにすると表示範囲がOpenStreetMapのタイルサーバーへ送られます。
        </small>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
