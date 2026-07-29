import React, {useState} from "react";
import type {ChatMessage as ChatMessageType} from "@/app/api/chat-rooms/[id]/messages/route";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import Image from 'next/image'
import {Check, Copy} from 'lucide-react'
import {cn} from "@/lib/utils";
import dayjs from "@/lib/dayjs";

interface ChatMessageProps {
    message: ChatMessageType
    isStreaming?: boolean
    isLastAssistant?: boolean
}

function ChatMessage({message, isStreaming, isLastAssistant}: ChatMessageProps) {
    const [copied, setCopied] = useState(false)
    const isAssistant = message.role === 'ASSISTANT'

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(message.content)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /* clipboard unavailable — ignore */
        }
    }

    if (!isAssistant) {
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%]">
                    <div className="mb-1 text-right text-xs text-muted-foreground">You</div>
                    <div className="rounded-2xl rounded-tr-sm border border-primary/20 bg-user px-4 py-2.5">
                        <Markdown
                            className="prose prose-invert prose-sm max-w-none prose-p:my-0 prose-headings:my-1"
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                        >
                            {message.content}
                        </Markdown>
                    </div>
                </div>
            </div>
        )
    }

    const showCaret = isStreaming && isLastAssistant

    return (
        <div className="flex gap-3">
            <div className="mt-0.5 shrink-0">
                <Image src="/favicon.ico" alt="Assistant" width={28} height={28} className="rounded-full"/>
            </div>
            <div className="min-w-0 max-w-[85%] flex-1">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-hidden="true"/>
                    <span className="font-medium text-foreground/80">Assistant</span>
                    {message.createdAt && (
                        <span className="hidden sm:inline">· {dayjs(message.createdAt).fromNow()}</span>
                    )}
                    {message.content && (
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="ml-auto inline-flex items-center gap-1 text-muted-foreground/70 transition-colors hover:text-foreground"
                            aria-label="Copy response"
                        >
                            {copied ? <Check className="h-3.5 w-3.5"/> : <Copy className="h-3.5 w-3.5"/>}
                            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                    )}
                </div>
                <div
                    className="relative overflow-hidden rounded-2xl rounded-tl-sm border border-border/60 bg-card py-4 pl-5 pr-5">
                    <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" aria-hidden="true"/>
                    {/* While streaming, render plain text — re-parsing the full
                        markdown (remark-gfm + math + katex) on every token is
                        O(n^2) and freezes the page. Format once streaming ends. */}
                    {showCaret ? (
                        <div className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/90">
                            {message.content}
                            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle"/>
                        </div>
                    ) : (
                    <Markdown
                        className={cn(
                            'prose prose-invert max-w-none',
                            'prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground',
                            'prose-h2:mt-7 prose-h2:mb-3 prose-h2:text-lg prose-h2:font-semibold',
                            'prose-h3:mt-6 prose-h3:mb-2.5 prose-h3:text-base prose-h3:font-semibold',
                            'prose-p:my-5 prose-p:leading-7 prose-p:text-foreground/90',
                            'prose-strong:font-bold prose-strong:text-foreground',
                            'prose-a:text-primary prose-a:underline-offset-2',
                            'prose-ul:my-5 prose-ol:my-5 prose-li:my-2.5 prose-li:leading-relaxed prose-ul:list-disc prose-ol:list-decimal',
                            'prose-table:my-5 prose-table:w-full prose-table:border-collapse prose-table:overflow-hidden prose-table:rounded-lg prose-table:text-sm',
                            'prose-thead:bg-primary/10',
                            'prose-th:border prose-th:border-white/10 prose-th:px-3 prose-th:py-2.5 prose-th:text-left prose-th:font-semibold prose-th:text-foreground',
                            'prose-td:border prose-td:border-white/10 prose-td:px-3 prose-td:py-2.5 prose-td:align-top prose-td:text-foreground/90',
                            "prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-[''] prose-code:after:content-['']",
                            'prose-pre:my-4 prose-pre:rounded-lg prose-pre:bg-muted prose-pre:p-4 prose-pre:text-foreground/90',
                            'prose-blockquote:my-4 prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground',
                            'prose-hr:my-6 prose-hr:border-border'
                        )}
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                    >
                        {message.content}
                    </Markdown>
                    )}
                </div>
            </div>
        </div>
    )
}

// Memoized: during streaming, only the streaming (last) message changes, so
// historical messages are skipped instead of re-parsing their markdown.
export default React.memo(ChatMessage)
