'use client';

import dynamic from 'next/dynamic';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import type { PromptVariable, PromptVariableType } from './prompt-model';

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => <div className="min-h-[320px] bg-background" />,
});

export interface PromptBodyEditorHandle {
  insertVariable: (name: string) => void;
  focus: () => void;
}

class VariableWidget extends WidgetType {
  constructor(private readonly name: string, private readonly type: PromptVariableType | 'unknown') {
    super();
  }

  override eq(other: VariableWidget) {
    return other.name === this.name && other.type === this.type;
  }

  override toDOM() {
    const span = document.createElement('span');
    span.className = `cm-variable-token cm-variable-token--${this.type}`;
    span.setAttribute('data-variable-name', this.name);
    span.setAttribute('data-variable-type', this.type);
    span.textContent = `{{${this.name}}}`;
    return span;
  }

  override ignoreEvent() {
    return false;
  }
}

function buildVariablePlugin(variableTypes: Map<string, PromptVariableType>) {
  const matcher = new MatchDecorator({
    regexp: /\{\{([^}]+)\}\}/g,
    decoration: (match: RegExpExecArray) => {
      const name = (match[1] ?? '').trim();
      const type = variableTypes.get(name) ?? ('unknown' as const);
      return Decoration.replace({ widget: new VariableWidget(name, type) });
    },
  });

  class VariableHighlighter {
    decorations;
    constructor(public view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    }
  }

  return ViewPlugin.fromClass(VariableHighlighter, {
    decorations: (v: VariableHighlighter) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  });
}

interface PromptBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variables: PromptVariable[];
  readOnly?: boolean;
}

export const PromptBodyEditor = forwardRef<PromptBodyEditorHandle, PromptBodyEditorProps>(function PromptBodyEditor(
  { value, onChange, placeholder, variables, readOnly = false },
  ref,
) {
  const viewRef = useRef<EditorView | null>(null);

  const extensions = useMemo(() => {
    const variableTypes = new Map<string, PromptVariableType>(variables.map((v) => [v.name, v.type]));
    return [buildVariablePlugin(variableTypes), EditorState.readOnly.of(readOnly)];
  }, [variables, readOnly]);

  useImperativeHandle(
    ref,
    () => ({
      insertVariable: (name: string) => {
        const view = viewRef.current;
        if (!view) return;
        const insertText = `{{${name}}}`;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: insertText },
          selection: { anchor: from + insertText.length },
        });
        view.focus();
      },
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return (
    <div className="prompt-body-editor" data-testid="prompt-body-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        minHeight="320px"
        placeholder={placeholder}
        editable={!readOnly}
        readOnly={readOnly}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !readOnly,
          highlightSelectionMatches: true,
        }}
      />
      <style>{`
        .prompt-body-editor .cm-editor {
          min-height: 320px;
          background: var(--background);
          color: var(--foreground);
          font-family:
            ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.7;
        }
        .prompt-body-editor .cm-scroller {
          min-height: 320px;
          font-family: inherit;
        }
        .prompt-body-editor .cm-gutters {
          background: color-mix(in srgb, var(--muted) 45%, transparent);
          color: var(--muted-foreground);
          border-right: 1px solid var(--border);
        }
        .prompt-body-editor .cm-activeLine,
        .prompt-body-editor .cm-activeLineGutter {
          background: color-mix(in srgb, var(--accent) 70%, transparent);
        }
        .prompt-body-editor .cm-content {
          padding: 14px 0;
        }
        .prompt-body-editor .cm-line {
          padding: 0 14px;
        }
        .prompt-body-editor .cm-placeholder {
          color: var(--muted-foreground);
        }
        .prompt-body-editor .cm-cursor {
          border-left-color: var(--primary);
        }
        .prompt-body-editor .cm-focused {
          outline: none;
        }
        .prompt-body-editor .cm-selectionBackground {
          background: color-mix(in srgb, var(--primary) 20%, transparent) !important;
        }
        .cm-variable-token {
          display: inline-flex;
          align-items: center;
          padding: 0 6px;
          border-radius: 4px;
          border: 1px solid transparent;
          font-family: inherit;
          font-size: 0.92em;
          line-height: 1.2;
          vertical-align: baseline;
        }
        .cm-variable-token--text {
          background: color-mix(in srgb, var(--warning, #f59e0b) 14%, transparent);
          border-color: color-mix(in srgb, var(--warning, #f59e0b) 40%, transparent);
          color: color-mix(in srgb, var(--warning, #f59e0b) 85%, var(--foreground));
        }
        .cm-variable-token--number {
          background: color-mix(in srgb, var(--success, #10b981) 14%, transparent);
          border-color: color-mix(in srgb, var(--success, #10b981) 40%, transparent);
          color: color-mix(in srgb, var(--success, #10b981) 85%, var(--foreground));
        }
        .cm-variable-token--image,
        .cm-variable-token--image_url,
        .cm-variable-token--image_base64 {
          background: color-mix(in srgb, var(--info, #0ea5e9) 14%, transparent);
          border-color: color-mix(in srgb, var(--info, #0ea5e9) 40%, transparent);
          color: color-mix(in srgb, var(--info, #0ea5e9) 85%, var(--foreground));
        }
        .cm-variable-token--unknown {
          background: color-mix(in srgb, var(--muted-foreground) 18%, transparent);
          border-color: color-mix(in srgb, var(--muted-foreground) 40%, transparent);
          color: var(--muted-foreground);
        }
      `}</style>
    </div>
  );
});
