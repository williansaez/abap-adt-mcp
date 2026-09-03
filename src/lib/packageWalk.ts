/** Walk a package (and sub-packages) through nodeContents, bounded. */

export interface PackageObject { name: string; type: string; objectUrl: string; description?: string; package: string; /** Set on function modules and includes reached through their function group. */ functionGroup?: string }
export interface PackageNode { package: string; packageUrl?: string; description?: string; subPackages: PackageNode[]; objects: PackageObject[] }
export interface PackageWalk { tree: PackageNode; objects: PackageObject[]; packageUrls: string[]; packages: string[]; truncated: boolean }

type NodeClient = { nodeContents(parentType: any, parentName?: string): Promise<{ nodes: any[] }> };

export async function walkPackage(client: NodeClient, packageName: string, opts: { maxDepth?: number; maxObjects?: number; objectTypes?: Set<string>; includeObjects?: boolean; /** Also list the function modules (FUGR/FF) and includes (FUGR/I) of each function group. */ expandFunctionGroups?: boolean } = {}): Promise<PackageWalk> {
  const maxDepth = opts.maxDepth ?? 99;
  const maxObjects = opts.maxObjects ?? 2000;
  const includeObjects = opts.includeObjects !== false;
  const objects: PackageObject[] = [];
  const packageUrls: string[] = [];
  const packages: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const visit = async (name: string, url: string | undefined, description: string | undefined, depth: number): Promise<PackageNode> => {
    const pkg = name.toUpperCase();
    const node: PackageNode = { package: pkg, packageUrl: url, description, subPackages: [], objects: [] };
    if (seen.has(pkg)) return node;
    seen.add(pkg);
    packages.push(pkg);
    if (url) packageUrls.push(url);
    const structure = await client.nodeContents('DEVC/K', pkg);
    const subs: any[] = [];
    for (const n of structure.nodes || []) {
      if (n.OBJECT_TYPE === 'DEVC/K') { subs.push(n); continue; }
      if (!includeObjects) continue;
      // A function group is kept when its members are wanted, so they can be expanded below.
      const wantsMembers = opts.expandFunctionGroups && n.OBJECT_TYPE === 'FUGR/F' && opts.objectTypes && (opts.objectTypes.has('FUGR/FF') || opts.objectTypes.has('FUGR/I'));
      const wantsSelf = !opts.objectTypes || opts.objectTypes.has(n.OBJECT_TYPE);
      if (!wantsSelf && !wantsMembers) continue;
      if (objects.length >= maxObjects) { truncated = true; continue; }
      if (wantsSelf) {
        const obj: PackageObject = { name: n.OBJECT_NAME, type: n.OBJECT_TYPE, objectUrl: n.OBJECT_URI, description: n.DESCRIPTION || undefined, package: pkg };
        node.objects.push(obj);
        objects.push(obj);
      }
      if (opts.expandFunctionGroups && n.OBJECT_TYPE === 'FUGR/F') {
        let members: any[] = [];
        try { members = (await client.nodeContents('FUGR/F', n.OBJECT_NAME)).nodes || []; } catch { members = []; }
        for (const m of members) {
          if (m.OBJECT_TYPE !== 'FUGR/FF' && m.OBJECT_TYPE !== 'FUGR/I') continue;
          if (!m.OBJECT_URI) continue;
          if (opts.objectTypes && !opts.objectTypes.has(m.OBJECT_TYPE)) continue;
          if (objects.length >= maxObjects) { truncated = true; break; }
          const member: PackageObject = { name: m.OBJECT_NAME, type: m.OBJECT_TYPE, objectUrl: m.OBJECT_URI, description: m.DESCRIPTION || undefined, package: pkg, functionGroup: n.OBJECT_NAME };
          node.objects.push(member);
          objects.push(member);
        }
      }
    }
    if (depth < maxDepth) {
      for (const n of subs) node.subPackages.push(await visit(n.OBJECT_NAME, n.OBJECT_URI, n.DESCRIPTION, depth + 1));
    }
    return node;
  };
  const tree = await visit(packageName, `/sap/bc/adt/packages/${encodeURIComponent(packageName.toLowerCase())}`, undefined, 0);
  return { tree, objects, packageUrls, packages, truncated };
}
