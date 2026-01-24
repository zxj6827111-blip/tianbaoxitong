import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary';
};

const Button: React.FC<ButtonProps> = ({ variant = 'default', className, ...props }) => {
  const baseStyles = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none ring-offset-background h-10 py-2 px-4 shadow-sm';
  const variantStyles = variant === 'primary' 
    ? 'bg-brand-600 text-white hover:bg-brand-700' 
    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50';

  const classes = [baseStyles, variantStyles, className].filter(Boolean).join(' ');

  return <button className={classes} {...props} />;
};

export default Button;
