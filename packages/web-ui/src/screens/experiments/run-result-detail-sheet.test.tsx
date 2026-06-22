import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RawResponseValue } from './run-result-detail-sheet';

describe('RawResponseValue', () => {
  it('renders JSON-looking raw LLM responses as the original text', () => {
    const raw = '{"risk":"high","reason":"json stays raw"}';

    render(<RawResponseValue value={raw} />);

    expect(screen.getByText(raw)).toBeInTheDocument();
    expect(screen.queryByText('risk')).not.toBeInTheDocument();
    expect(screen.queryByText('high')).not.toBeInTheDocument();
  });
});
