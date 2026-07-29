'use client'

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Menu, Send, Settings} from 'lucide-react';
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import LogoutButton from "@/components/auth/logout-button";

import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import ChatSideBar from "@/components/chat/chat-side-bar";
import ChatMessage from "@/components/chat/chat-message";
import useSWR from "swr";
import {useParams} from "next/navigation";
import {ChatMessageListResponse} from "@/app/api/chat-rooms/[id]/messages/route";
import {ChatRole} from "@prisma/client";
import ChatSettingSideBar from "@/components/chat/chat-setting-side-bar";
import {useTranslations} from "next-intl";
import {NavLinks} from "@/components/ui/nav-links";
import Link from "next/link";

interface ScreenProps {
    isMobile: boolean;
}

export default function Screen(
    {isMobile}: ScreenProps
) {
    const {id} = useParams<{ id: string }>();
    const t = useTranslations('Chat')

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [inputText, setInputText] = useState('');
    const [sources] = useState([]);
    const [isJsonViewerOpen, setIsJsonViewerOpen] = useState(false);
    const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(!isMobile);
    const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(!isMobile);
    const [isStreaming, setIsStreaming] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const {data, mutate} = useSWR<ChatMessageListResponse>(`/api/chat-rooms/${id}/messages`, async (url: string) => {
        const response = await fetch(url);
        return response.json();
    });
    const messages = useMemo(() => data?.chatMessages || [], [data]);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({behavior: 'smooth'});
        }
    }, [messages]);

    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }, [inputText])

    const handleSendMessage = async () => {
        if (!inputText.trim()) return;

        // Clear input
        setInputText('');
        setIsStreaming(true);

        const oldMessages = [...messages, {
            id: new Date().toISOString(),
            content: inputText,
            role: 'USER' as ChatRole,
            createdAt: new Date(),
        }];
        await mutate({chatMessages: oldMessages}, {revalidate: false});

        const response = await fetch(`/api/chat-rooms/${id}/messages`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                content: inputText,
                role: 'USER',
            })
        });

        // Read as a stream. The server emits newline-delimited JSON, one
        // {content} object per line (cumulative). A single read() can return a
        // partial line or several lines at once, so buffer the input and only
        // parse COMPLETE lines — otherwise a chunk boundary mid-JSON throws
        // "Unterminated string in JSON" and the whole response vanishes.
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const createdAt = new Date();
        let buffer = '';

        const handleLine = async (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let parsed: { content?: string; error?: string };
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                // Malformed/incomplete fragment — skip; more data may follow.
                return;
            }
            if (parsed.error) {
                console.error('Error from LLM:', parsed.error);
                return;
            }
            if (parsed.content) {
                await mutate({
                    chatMessages: [
                        ...oldMessages,
                        {id: new Date().toISOString(), content: parsed.content, role: 'ASSISTANT', createdAt}
                    ]
                }, {revalidate: false});
            }
        };

        try {
            if (reader) {
                let done = false;
                while (!done) {
                    const {value, done: isDone} = await reader.read();
                    done = isDone;
                    buffer += decoder.decode(value, {stream: !done});
                    const lines = buffer.split('\n');
                    // Keep the trailing (possibly incomplete) segment buffered.
                    buffer = lines.pop() ?? '';
                    for (const line of lines) {
                        await handleLine(line);
                    }
                }
                // Flush anything left after the stream closes.
                await handleLine(buffer);
                buffer = '';
                await mutate();
            }
        } finally {
            setIsStreaming(false);
        }
    };

    return (
        <div className="h-screen flex flex-col">
            <div className="bg-background border-b h-14 flex items-center px-4 shrink-0">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="default" onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}>
                        <Menu className="w-4 h-4"/>
                    </Button>
                    <Link href="/" className="text-lg font-semibold tracking-tight transition-colors hover:text-primary">OpenHealth</Link>
                </div>
                <div className="flex-1"/>
                <div className="flex items-center gap-4">
                    <NavLinks/>
                    <div className="flex items-center gap-1">
                        <LogoutButton/>
                        <Button variant="ghost" size="default"
                                onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}>
                            <Settings className="w-4 h-4"/>
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Left sidebar */}
                {isLeftSidebarOpen && (
                    <div className="w-72 border-r bg-card flex flex-col overflow-hidden">
                        <ChatSideBar chatRoomId={id} isLeftSidebarOpen={true}/>
                    </div>
                )}

                {/* Main content */}
                <div className="flex-1 flex flex-col bg-background min-w-0">
                    <div className="flex-1 overflow-y-auto">
                        <div className="mx-auto w-full max-w-7xl space-y-8 p-4 md:p-6">
                            {messages.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center py-20 text-center">
                                    <h2 className="text-2xl font-semibold tracking-tight">
                                        {t('emptyState.greeting')}
                                    </h2>
                                    <p className="mt-2 text-muted-foreground">{t('emptyState.subtitle')}</p>
                                    <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                                        {(Object.values(t.raw('suggestedPrompts') as Record<string, string>)).map((prompt) => (
                                            <button
                                                key={prompt}
                                                type="button"
                                                onClick={() => setInputText(prompt)}
                                                className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:border-primary/40 hover:bg-muted"
                                            >
                                                {prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                messages.map((message, index) => {
                                    const isLast = index === messages.length - 1
                                    return (
                                        <ChatMessage
                                            key={index}
                                            message={message}
                                            isStreaming={isStreaming}
                                            isLastAssistant={isLast && message.role === 'ASSISTANT'}
                                        />
                                    )
                                })
                            )}
                            <div ref={messagesEndRef}/>
                        </div>
                    </div>
                    <div className="mb-16 md:mb-0">
                        <div className="border-t border-border p-4">
                            <div className="mx-auto flex w-full max-w-7xl items-end gap-2">
                                <Textarea
                                    ref={textareaRef}
                                    rows={1}
                                    placeholder={t('inputPlaceholder')}
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                    className="max-h-40 resize-none"
                                />
                                <Button onClick={handleSendMessage} disabled={isStreaming || !inputText.trim()}>
                                    <Send className="h-4 h-4"/>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right sidebar */}
                {isRightSidebarOpen && (
                    <div className="w-80 border-l bg-card flex flex-col overflow-y-auto">
                        <ChatSettingSideBar chatRoomId={id}/>
                    </div>
                )}
            </div>

            <Dialog open={isJsonViewerOpen} onOpenChange={setIsJsonViewerOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader><DialogTitle>Source Data</DialogTitle></DialogHeader>
                    <div className="overflow-y-auto">
            <pre className="text-xs bg-muted p-4 rounded overflow-auto">
              {JSON.stringify(sources, null, 2)}
            </pre>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
