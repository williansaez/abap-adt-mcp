import { walkPackage } from '../packageWalk';
import { abapgitFileName } from '../abapgitExport';

const client: any = {
  nodeContents: jest.fn(async (type: string, name: string) => {
    if (type === 'DEVC/K' && name === 'ZPKG') return { nodes: [
      { OBJECT_TYPE: 'CLAS/OC', OBJECT_NAME: 'ZCL_A', OBJECT_URI: '/sap/bc/adt/oo/classes/zcl_a' },
      { OBJECT_TYPE: 'FUGR/F', OBJECT_NAME: 'ZFG', OBJECT_URI: '/sap/bc/adt/functions/groups/zfg' },
    ] };
    if (type === 'FUGR/F' && name === 'ZFG') return { nodes: [
      { OBJECT_TYPE: 'FUGR/FF', OBJECT_NAME: 'Z_FM_ONE', OBJECT_URI: '/sap/bc/adt/functions/groups/zfg/fmodules/z_fm_one' },
      { OBJECT_TYPE: 'FUGR/I', OBJECT_NAME: 'LZFGTOP', OBJECT_URI: '/sap/bc/adt/functions/groups/zfg/includes/lzfgtop' },
      { OBJECT_TYPE: 'FUGR/PX', OBJECT_NAME: 'X', OBJECT_URI: '/x' },
    ] };
    return { nodes: [] };
  }),
};

describe('walkPackage', () => {
  it('lists function modules and includes under their group only when asked', async () => {
    const plain = await walkPackage(client, 'ZPKG');
    expect(plain.objects.map(o => o.type)).toEqual(['CLAS/OC', 'FUGR/F']);
    const expanded = await walkPackage(client, 'ZPKG', { expandFunctionGroups: true });
    expect(expanded.objects.map(o => `${o.type}:${o.name}`)).toEqual(['CLAS/OC:ZCL_A', 'FUGR/F:ZFG', 'FUGR/FF:Z_FM_ONE', 'FUGR/I:LZFGTOP']);
    expect(expanded.objects[2].functionGroup).toBe('ZFG');
    const onlyFms = await walkPackage(client, 'ZPKG', { expandFunctionGroups: true, objectTypes: new Set(['FUGR/FF']) });
    expect(onlyFms.objects.map(o => o.name)).toEqual(['Z_FM_ONE']);
  });

  it('names function group members the abapGit way', () => {
    expect(abapgitFileName('Z_FM_ONE', 'FUGR/FF', undefined, 'ZFG')).toBe('zfg.fugr.z_fm_one.abap');
    expect(abapgitFileName('LZFGTOP', 'FUGR/I', undefined, '/ACME/FG')).toBe('#acme#fg.fugr.lzfgtop.abap');
    expect(abapgitFileName('Z_FM_ONE', 'FUGR/FF')).toBeUndefined();
  });
});
