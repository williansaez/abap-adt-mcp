/** abapGit-style file names for repository objects. */
import path from 'path';

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
};

export const EXPORTABLE_TYPES = Object.keys(EXT);

/** abapGit escapes namespaces: /ACME/CL_X -> #acme#cl_x */
export function abapgitBaseName(objectName: string): string {
  return objectName.toLowerCase().replace(/\//g, '#');
}

export function abapgitFileName(objectName: string, objectType: string, include?: 'locals_imp' | 'locals_def' | 'testclasses' | 'macros'): string | undefined {
  const ext = EXT[objectType];
  if (!ext) return undefined;
  const base = abapgitBaseName(objectName);
  if (include && objectType === 'CLAS/OC') return `${base}.clas.${include}.abap`;
  return `${base}${ext}`;
}

export const CLASS_INCLUDES: Array<{ include: 'locals_imp' | 'locals_def' | 'testclasses' | 'macros'; adtInclude: string }> = [
  { include: 'locals_def', adtInclude: 'definitions' },
  { include: 'locals_imp', adtInclude: 'implementations' },
  { include: 'testclasses', adtInclude: 'testclasses' },
  { include: 'macros', adtInclude: 'macros' },
];

/** Resolve and validate the export directory: absolute, no traversal, inside MCP_EXPORT_ROOT when set. */
export function resolveExportDir(targetDir: string, root: string | undefined): string {
  if (!targetDir || !path.isAbsolute(targetDir)) throw new Error('targetDir must be an absolute path');
  const resolved = path.resolve(targetDir);
  if (root) {
    const r = path.resolve(root);
    if (resolved !== r && !resolved.startsWith(r + path.sep)) throw new Error(`targetDir must be inside MCP_EXPORT_ROOT (${r})`);
  }
  return resolved;
}
