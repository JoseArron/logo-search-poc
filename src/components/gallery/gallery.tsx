"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { LogoSummary, PhotoRecord } from "@/app/repositories/logo-index";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type GalleryProps = {
  initialPhotos: PhotoRecord[];
  logos: LogoSummary[];
};

const FALLBACK_IMAGE = "/globe.svg";

export function Gallery({ initialPhotos, logos }: GalleryProps) {
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);

  const filteredPhotos = useMemo(() => {
    if (!selectedLogo) {
      return initialPhotos;
    }

    return initialPhotos.filter((photo) =>
      photo.logos?.some((logo) => logo.slug === selectedLogo),
    );
  }, [initialPhotos, selectedLogo]);

  const activeLogoSummary = useMemo(() => {
    if (!selectedLogo) {
      return null;
    }

    return logos.find((logo) => logo.slug === selectedLogo) ?? null;
  }, [logos, selectedLogo]);

  const totalPhotosLabel = selectedLogo
    ? `${filteredPhotos.length} photo${
        filteredPhotos.length === 1 ? "" : "s"
      } with ${activeLogoSummary?.name ?? selectedLogo}`
    : `${initialPhotos.length} photo${initialPhotos.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">Logo Search POC</h1>
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
          Click on a logo to show photos that contain it.
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={selectedLogo ? "outline" : "default"}
            onClick={() => setSelectedLogo(null)}
          >
            All photos
          </Button>
          {logos.map((logo) => (
            <Button
              key={logo.slug}
              variant={selectedLogo === logo.slug ? "default" : "outline"}
              onClick={() => setSelectedLogo(logo.slug)}
            >
              <span>{logo.name}</span>
              <span className="text-muted-foreground ml-1 text-xs">
                {logo.totalPhotos}
              </span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">
          {totalPhotosLabel}
        </p>
      </section>

      <section>
        {filteredPhotos.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p>No photos contain that logo yet.</p>
            <p className="text-xs">Try selecting another logo.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredPhotos.map((photo) => (
              <article
                key={photo.id}
                className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                  <Link
                    href={photo.imageUrl ?? FALLBACK_IMAGE}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Image
                      src={photo.imageUrl ?? FALLBACK_IMAGE}
                      alt={`Logo detection asset ${photo.id}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
                      priority={false}
                      unoptimized={!photo.imageUrl}
                    />
                  </Link>
                </div>
                <div className="flex flex-1 flex-col gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium">{photo.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {photo.s3Key ?? "unnamed"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {photo.logos.length === 0 ? (
                      <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">
                        No logos detected
                      </span>
                    ) : (
                      photo.logos.map((logo, index) => (
                        <span
                          key={`${photo.id}-${logo.slug}-${
                            logo.detectionIndex ?? index
                          }`}
                          className={cn(
                            "rounded-full border px-2 py-1 text-xs",
                            logo.slug === selectedLogo
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-foreground",
                          )}
                        >
                          {logo.name}
                          {typeof logo.confidence === "number" &&
                          logo.confidence > 0
                            ? ` · ${(logo.confidence * 100).toFixed(0)}%`
                            : null}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
