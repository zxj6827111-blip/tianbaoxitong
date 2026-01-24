import React from 'react';

type BadgeProps = {
  variant?: 'default' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
};

const variantClassMap: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800',
  success: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800',
  warning: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800',
  danger: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800'
};

const Badge: React.FC<BadgeProps> = ({ variant = 'default', children }) => {
  return <span className={variantClassMap[variant]}>{children}</span>;
};

export default Badge;
