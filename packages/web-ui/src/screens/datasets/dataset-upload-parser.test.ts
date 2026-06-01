import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferRole, parseDatasetFile, projectSamplesToColumns, selectDatasetFile } from './dataset-upload-parser';

function makeFile(name: string, content: string, relativePath?: string) {
  const file = new File([content], name, { type: 'application/json' });
  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: relativePath,
    });
  }
  return file;
}

function makeStreamingFile(name: string, content: string, chunkSize = 31) {
  const encoded = bytes(content);
  return {
    name,
    size: encoded.byteLength,
    type: 'application/x-ndjson',
    text: async () => {
      throw new Error('text_should_not_be_read');
    },
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < encoded.byteLength; offset += chunkSize) {
            controller.enqueue(encoded.subarray(offset, offset + chunkSize));
          }
          controller.close();
        },
      }),
  } as unknown as File;
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function uint32(value: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function uint16(value: number) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function makeStoredZipFile(entries: Record<string, Uint8Array | string>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const [path, rawData] of Object.entries(entries)) {
    const name = bytes(path);
    const data = typeof rawData === 'string' ? bytes(rawData) : rawData;
    const localHeader = concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(data.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
      name,
    ]);
    const centralHeader = concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(data.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(localOffset),
      name,
    ]);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = concat(centralParts);
  const endOfCentralDirectory = concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(Object.keys(entries).length),
    uint16(Object.keys(entries).length),
    uint32(centralDirectory.length),
    uint32(localOffset),
    uint16(0),
  ]);

  return new File([concat([...localParts, centralDirectory, endOfCentralDirectory])], 'images.zip', {
    type: 'application/zip',
  });
}

describe('dataset upload parser', () => {
  it('parses the ChnSentiCorp random-50 JSONL as exactly 50 samples', async () => {
    const fixturePath = resolve(
      process.cwd(),
      '../../datasets/chnsenticorp/subsets/random-50/chnsenticorp-random-50.jsonl',
    );
    const file = makeFile('chnsenticorp-random-50.jsonl', await readFile(fixturePath, 'utf8'));

    const parsed = await parseDatasetFile(file);

    expect(parsed.samples).toHaveLength(50);
    expect(parsed.columns).toEqual(['sample_id', 'text', 'expected_output', 'split', 'source_dataset']);
  });

  it('selects the manifest-referenced data file when a folder is uploaded', async () => {
    const dataFile = makeFile(
      'chnsenticorp-random-50.jsonl',
      '{"text":"hello","label":"positive"}\n',
      'random-50/chnsenticorp-random-50.jsonl',
    );
    const manifestFile = makeFile(
      'manifest.json',
      JSON.stringify({ file: 'chnsenticorp-random-50.jsonl', sample_count: 1 }),
      'random-50/manifest.json',
    );

    await expect(selectDatasetFile([manifestFile, dataFile])).resolves.toBe(dataFile);
  });

  it('does not infer label metadata helper columns as expected output', () => {
    expect(inferRole('label', 1)).toBe('expected');
    expect(inferRole('review_label', 'correct')).toBe('expected');
    expect(inferRole('label_name', 'positive')).toBe('metadata');
  });

  it('parses CSV JSON array cells without splitting URL punctuation', async () => {
    const file = makeFile(
      'images.csv',
      [
        'sample_id,image_urls,expected_output',
        'case-1,"[""https://example.test/a,b.png?x=1;2"",""https://example.test/c.png?next=https%3A%2F%2Ffoo.test%2F1,2""]",pass',
      ].join('\n'),
    );

    const parsed = await parseDatasetFile(file);

    expect(parsed.samples[0]?.['image_urls']).toEqual([
      'https://example.test/a,b.png?x=1;2',
      'https://example.test/c.png?next=https%3A%2F%2Ffoo.test%2F1,2',
    ]);
    expect(inferRole('attachments', parsed.samples[0]?.['image_urls'])).toBe('image');
  });

  it('parses ZIP datasets and inlines same-package images as data URLs', async () => {
    const file = makeStoredZipFile({
      'manifest.json': JSON.stringify({ file: 'data/images.csv' }),
      'data/images.csv': [
        'sample_id,image_path,image_paths,expected_output',
        'zip-1,images/a.png,"[""images/a.png"",""images/b.jpg""]",ok',
      ].join('\n'),
      'data/images/a.png': new Uint8Array([137, 80, 78, 71]),
      'data/images/b.jpg': new Uint8Array([255, 216, 255, 217]),
    });

    const parsed = await parseDatasetFile(file);

    expect(parsed.columns).toEqual(['sample_id', 'image_path', 'image_paths', 'expected_output']);
    expect(parsed.samples[0]?.['image_path']).toBe('data:image/png;base64,iVBORw==');
    expect(parsed.samples[0]?.['image_paths']).toEqual([
      'data:image/png;base64,iVBORw==',
      'data:image/jpeg;base64,/9j/2Q==',
    ]);
  });

  it('projects samples to only selected import fields', () => {
    expect(
      projectSamplesToColumns(
        [
          { sample_id: 'case-1', text: 'hello', label: 'positive', source: 'fixture' },
          { sample_id: 'case-2', text: 'bye', source: 'fixture' },
        ],
        ['sample_id', 'text'],
      ),
    ).toEqual([
      { sample_id: 'case-1', text: 'hello' },
      { sample_id: 'case-2', text: 'bye' },
    ]);
  });

  it('parses well beyond 5000 samples without truncating', async () => {
    const rowCount = 6000;
    const content = Array.from({ length: rowCount }, (_, index) =>
      JSON.stringify({ sample_id: `case-${index}`, text: `sample ${index}` }),
    ).join('\n');

    const parsed = await parseDatasetFile(makeFile('large.jsonl', content));
    expect(parsed.samples.length).toBe(rowCount);
  });

  it('fails on a malformed JSONL line instead of silently skipping it', async () => {
    const content = [JSON.stringify({ sample_id: 'case-1', text: 'ok' }), '{'].join('\n');

    await expect(parseDatasetFile(makeFile('malformed.jsonl', content))).rejects.toThrow();
  });

  it('streams JSONL files instead of reading the full text payload up front', async () => {
    const rowCount = 12;
    const content = Array.from({ length: rowCount }, (_, index) =>
      JSON.stringify({ sample_id: `case-${index}`, text: `sample ${index}` }),
    ).join('\n');

    const parsed = await parseDatasetFile(makeStreamingFile('streamed.jsonl', content));
    expect(parsed.samples.length).toBe(rowCount);
    expect(parsed.samples[0]).toEqual({ sample_id: 'case-0', text: 'sample 0' });
  });
});
