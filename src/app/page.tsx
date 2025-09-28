import { fetchAllLogos, fetchAllPhotos } from "@/app/repositories/logo-index";
import { Gallery } from "@/components/gallery/gallery";

export default async function Home() {
  try {
    const [photos, logos] = await Promise.all([
      fetchAllPhotos(),
      fetchAllLogos(),
    ]);

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12">
        <Gallery initialPhotos={photos} logos={logos} />
      </main>
    );
  } catch (error) {
    console.error("Failed to load gallery", error);

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Configuration required</h1>
        <p className="text-muted-foreground">
          The app couldn&apos;t reach DynamoDB. Double-check AWS credentials and
          the
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            DYNAMO_TABLE
          </code>
          environment variable in your
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            .env
          </code>
          file.
        </p>
      </main>
    );
  }
}
