import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary';
};

const Button: React.FC<ButtonProps> = ({ variant = 'default', className, ...props }) => {
  const classes = ['button', variant === 'primary' ? 'primary' : '', className]
    .filter(Boolean)
    .join(' ');

  return <button className={classes} {...props} />;
};

export default Button;
