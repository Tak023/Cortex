import Link from "next/link";
import { containerLogs, inspectContainer } from "@/lib/docker";

export const dynamic = "force-dynamic";

export default async function ContainerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let inspect = "";
  let logs = "";
  let error = "";
  try {
    inspect = await inspectContainer(id);
    logs = await containerLogs(id, 250);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let pretty = inspect;
  try {
    pretty = JSON.stringify(JSON.parse(inspect), null, 2);
  } catch {
    /* keep raw */
  }

  return (
    <div className="grid">
      <div className="card">
        <Link href="/">← All containers</Link>
        <div className="name" style={{ marginTop: 12 }}>
          Container <span className="mono">{id.slice(0, 12)}</span>
        </div>
        <div className="meta">Inspect + recent logs from local Docker</div>
      </div>

      {error ? (
        <div className="card error">{error}</div>
      ) : (
        <>
          <div className="card">
            <div className="name">Logs (tail 250)</div>
            <pre>{logs || "(no log output)"}</pre>
          </div>
          <div className="card">
            <div className="name">Inspect JSON</div>
            <pre>{pretty}</pre>
          </div>
        </>
      )}
    </div>
  );
}
