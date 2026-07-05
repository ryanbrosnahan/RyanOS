"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ value, className = "" }: { value: string; className?: string }) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-800 underline-offset-2 hover:text-emerald-950 hover:underline"
              >
                {children}
              </a>
            );
          },
          p({ children }) {
            return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>;
          },
          li({ children }) {
            return <li className="pl-1">{children}</li>;
          },
          h1({ children }) {
            return <h1 className="mt-3 text-base font-semibold text-stone-950 first:mt-0">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="mt-3 text-sm font-semibold text-stone-950 first:mt-0">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="mt-3 text-sm font-semibold text-stone-900 first:mt-0">{children}</h3>;
          },
          blockquote({ children }) {
            return <blockquote className="my-2 border-l-2 border-stone-300 pl-3 text-stone-600">{children}</blockquote>;
          },
          code({ children }) {
            return <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em] text-stone-900">{children}</code>;
          }
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
