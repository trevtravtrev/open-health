import React from 'react';
import { Github, MessageCircle, MessagesSquare } from 'lucide-react';

export function Footer() {
  return (
    <footer className="fixed bottom-0 w-full h-12 bg-background/80 backdrop-blur-md border-t border-border">
      <div className="h-full container mx-auto flex justify-center items-center gap-6">
        <a
          href="https://github.com/OpenHealthForAll/open-health"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 text-muted-foreground hover:text-foreground transition-all"
        >
          <Github className="w-[14px] h-[14px]" />
          <span className="text-[13px] font-medium">Github</span>
        </a>
        <a
          href="https://www.reddit.com/r/AIDoctor/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 text-muted-foreground hover:text-foreground transition-all"
        >
          <MessageCircle className="w-[14px] h-[14px]" />
          <span className="text-[13px] font-medium">Reddit</span>
        </a>
        <a
          href="https://discord.gg/B9K654g4wf"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 text-muted-foreground hover:text-foreground transition-all"
        >
          <MessagesSquare className="w-[14px] h-[14px]" />
          <span className="text-[13px] font-medium">Discord</span>
        </a>
      </div>
    </footer>
  );
} 