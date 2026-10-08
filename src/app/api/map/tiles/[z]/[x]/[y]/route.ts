import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TileContext = {
  params: Promise<{ z: string; x: string; y: string }>;
};

function parseTileCoordinate(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(request: Request, { params }: TileContext) {
  const raw = await params;
  const z = parseTileCoordinate(raw.z);
  const x = parseTileCoordinate(raw.x);
  const y = parseTileCoordinate(raw.y);

  if (
    z === null || x === null || y === null ||
    z > 20 || x >= 2 ** z || y >= 2 ** z
  ) {
    return NextResponse.json({ error: "INVALID_TILE_COORDINATES" }, { status: 400 });
  }

  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "MAP_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
  }

  // Restrict selectable styles: no arbitrary URLs or providers can be requested.\n  const styleQuery = new URL(request.url).searchParams.get("style");\n  const style = styleQuery === "positron" ? "positron" : "osm-bright";\n\n  // Keep the Geoapify key on the server rather than embedding it in browser requests.
  const tileUrl = new URL(
    `https://maps.geoapify.com/v1/tile/${style}/${z}/${x}/${y}.png`
  );
  tileUrl.searchParams.set("apiKey", key);

  try {
    const upstream = await fetch(tileUrl, {
      signal: AbortSignal.timeout(12000),
      cache: "force-cache"
    });

    if (!upstream.ok) {
      console.error("[di-dau] Geoapify tile unavailable", {
        status: upstream.status,
        zoom: z
      });
      return NextResponse.json(
        { error: "MAP_TILE_UNAVAILABLE" },
        { status: upstream.status === 429 ? 503 : 502 }
      );
    }

    if (!(upstream.headers.get("content-type") ?? "").includes("image/png")) {
      return NextResponse.json({ error: "INVALID_TILE_RESPONSE" }, { status: 502 });
    }

    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "MAP_PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}
