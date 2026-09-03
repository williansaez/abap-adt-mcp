import { normalizeArgs } from '../argAliases';

const schema = (props: string[], required: string[] = []) => ({ type: 'object', properties: Object.fromEntries(props.map(p => [p, { type: 'string' }])), required });

describe('normalizeArgs', () => {
  it('maps case variants and known aliases onto the schema names', () => {
    expect(normalizeArgs(schema(['transportNumber'], ['transportNumber']), { TransportNumber: 'DEVK1' })).toEqual({ args: { transportNumber: 'DEVK1' }, renamed: { TransportNumber: 'transportNumber' } });
    expect(normalizeArgs(schema(['objSourceUrl']), { objectSourceUrl: '/x' }).args).toEqual({ objSourceUrl: '/x' });
    expect(normalizeArgs(schema(['objSourceUrl']), { uri: '/x' }).args).toEqual({ objSourceUrl: '/x' });
    expect(normalizeArgs(schema(['objectUrl']), { objectSourceUrl: '/x' }).args).toEqual({ objectUrl: '/x' });
    expect(normalizeArgs(schema(['clas']), { className: 'ZCL' }).args).toEqual({ clas: 'ZCL' });
    expect(normalizeArgs(schema(['REQUEST_TEXT', 'DEVCLASS', 'objSourceUrl']), { description: 'd', packageName: 'ZP', objectUrl: '/o' }).args).toEqual({ REQUEST_TEXT: 'd', DEVCLASS: 'ZP', objSourceUrl: '/o' });
    expect(normalizeArgs(schema(['code', 'url'], ['url']), { source: 'x', objectSourceUrl: '/u' }).args).toEqual({ code: 'x', url: '/u' });
  });

  it('never overwrites a schema key that is already present and leaves unknown keys alone', () => {
    const r = normalizeArgs(schema(['objectUrl', 'lockHandle']), { objectUrl: '/a', objectSourceUrl: '/b', foo: 1 });
    expect(r.args).toEqual({ objectUrl: '/a', objectSourceUrl: '/b', foo: 1 });
    expect(r.renamed).toEqual({});
    expect(normalizeArgs(undefined, { a: 1 }).args).toEqual({ a: 1 });
  });

  it('prefers a required target when an alias could fill several', () => {
    expect(normalizeArgs(schema(['url', 'mainUrl'], ['url']), { objectSourceUrl: '/u' }).args).toEqual({ url: '/u' });
  });
});
