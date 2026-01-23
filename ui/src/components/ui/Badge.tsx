import React from 'react';

type BadgeProps = {
  variant?: 'default' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
};

const variantClassMap: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'badge',
  success: 'badge success',
  warning: 'badge warning',
  danger: 'badge danger'
};

const Badge: React.FC<BadgeProps> = ({ variant = 'default', children }) => {
  return <span className={variantClassMap[variant]}>{children}</span>;
};

export default Badge;
