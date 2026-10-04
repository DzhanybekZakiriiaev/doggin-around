// Every world downloaded by `npm run worlds` (worlds/out/<scene>/<run>/world.json), newest first.
// In dev Vite serves the files straight from the project folder; a build copies them into dist/ (vite.config.ts).

interface RunRecord {
  label?: string;
  world: {
    world_id: string;
    model?: string;
    assets?: {
      splats?: {
        spz_urls?: Record<string, string>;
        semantics_metadata?: { metric_scale_factor?: number | null; ground_plane_offset?: number | null } | null;
      };
    };
  };
}

export interface WorldRun {
  id: string; // "<scene>/<run folder>"
  scene: string;
  label: string;
  baseUrl: string;
  resolutions: string[];
  metricScale?: number;
}

const records = import.meta.glob<RunRecord>('../../worlds/out/*/*/world.json', { eager: true, import: 'default' });

export const worldRuns: WorldRun[] = Object.entries(records)
  .map(([file, record]) => {
    const [, scene, run] = file.match(/worlds\/out\/([^/]+)\/([^/]+)\/world\.json$/)!;
    const model = record.world.model?.replace('marble-', '') ?? 'world';
    const when = run.slice(5, 16).replace('T', ' ').replace('-', ':'); // "MM-DD HH:MM" from the folder timestamp
    const metricScale = record.world.assets?.splats?.semantics_metadata?.metric_scale_factor ?? undefined;
    return {
      id: `${scene}/${run}`,
      scene,
      label: `${scene} · ${model}${record.label && record.label !== model ? ` (${record.label})` : ''} · ${when} · ${record.world.world_id.slice(0, 8)}`,
      baseUrl: `/worlds/out/${scene}/${run}/`,
      resolutions: Object.keys(record.world.assets?.splats?.spz_urls ?? {}),
      metricScale: metricScale ?? undefined,
    };
  })
  .sort((a, b) => b.id.split('/')[1].localeCompare(a.id.split('/')[1]));
