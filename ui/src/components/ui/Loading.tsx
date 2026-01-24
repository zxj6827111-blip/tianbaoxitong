import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingProps {
  fullScreen?: boolean;
  text?: string;
}

export const Loading: React.FC<LoadingProps> = ({ fullScreen = false, text = '加载中...' }) => {
  const containerClass = fullScreen
    ? 'fixed inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-50 animate-fade-in'
    : 'flex items-center justify-center p-8';

  return (
    <div className={containerClass}>
      <div className="text-center flex flex-col items-center gap-3">
        <Loader2 className="w-10 h-10 text-brand-600 animate-spin" />
        {text && <p className="text-sm font-medium text-slate-600 animate-pulse">{text}</p>}
      </div>
    </div>
  );
};
