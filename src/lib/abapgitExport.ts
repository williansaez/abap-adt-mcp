/** abapGit-style file names for repository objects. */
import path from 'path';
import fs from 'fs';
import os from 'os';

const EXT: Record<string, string> = {
  'CLAS/OC': '.clas.abap',
  'INTF/OI': '.intf.abap',
  'PROG/P': '.prog.abap',
  'PROG/I': '.prog.abap',
  'DDLS/DF': '.ddls.asddls',
  'DCLS/DL': '.dcls.asdcls',
  'DDLX/EX': '.ddlx.asddlxs',
  'BDEF/BDO': '.bdef.asbdef',
  'SRVD/SRV': '.srvd.srvdsrv',
  // Function modules and includes are exported as members of their group (abapGit: zfg.fugr.zfm.abap).
  'FUGR/FF': '.abap',
  'FUGR/I': '.abap',
};

export const EXPORTABLE_TYPES = Object.keys(EXT);

/** abapGit escapes namespaces: /ACME/CL_X -> #acme#cl_x */
export function abapgitBaseName(objectName: string): string {
  return objectName.toLowerCase().replace(/\//g, '#');
}

export function abapgitFileName(objectName: string, objectType: string, include?: 'locals_imp' | 'locals_def' | 'testclasses' | 'macros', functionGroup?: string): string | undefined {
  const ext = EXT[objectType];
  if (!ext) return undefined;
  const base = abapgitBaseName(objectName);
  if (include && objectType === 'CLAS/OC') return `${base}.clas.${include}.abap`;
  if (objectType === 'FUGR/FF' || objectType === 'FUGR/I') {
    if (!functionGroup) return undefined;
    return `${abapgitBaseName(functionGroup)}.fugr.${base}.abap`;
  }
  return `${base}${ext}`;
}

export const CLASS_INCLUDES: Array<{ include: 'locals_imp' | 'locals_def' | 'testclasses' | 'macros'; adtInclude: string }> = [
  { include: 'locals_def', adtInclude: 'definitions' },
  { include: 'locals_imp', adtInclude: 'implementations' },
  { include: 'testclasses', adtInclude: 'testclasses' },
  { include: 'macros', adtInclude: 'macros' },
];

export const DEFAULT_EXPORT_ROOT = path.join(os.homedir(), '.abap-adt-mcp', 'exports');

/**
 * Resolve and validate the export directory: absolute, inside the export
 * root (MCP_EXPORT_ROOT, default ~/.abap-adt-mcp/exports), compared on real
 * paths so a symlink inside the root cannot point outside it. The directory
 * is created so its real path can be checked.
 */
export function resolveExportDir(targetDir: string, root: string | undefined): string {
  if (!targetDir || !path.isAbsolute(targetDir)) throw new Error('targetDir must be an absolute path');
  const rootDir = path.resolve(root || DEFAULT_EXPORT_ROOT);
  const resolved = path.resolve(targetDir);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    throw new Error(`targetDir must be inside the export root ${rootDir} (MCP_EXPORT_ROOT, default ~/.abap-adt-mcp/exports)`);
  }
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const realRoot = fs.realpathSync(rootDir);
  fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync(resolved);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error(`targetDir resolves outside the export root ${rootDir} (symlink)`);
  }
  return real;
}
