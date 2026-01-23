import React from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input: React.FC<InputProps> = ({ className, ...props }) => {
  const classes = ['input', className].filter(Boolean).join(' ');
  return <input className={classes} {...props} />;
};

export default Input;
