'use client';

import ReactBarcode from 'react-barcode';

interface BarcodeProps {
  value: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
}

export function Barcode({ value, width = 1.5, height = 40, displayValue = true }: BarcodeProps) {
  if (!value) return null;
  
  return (
    <div className="flex flex-col items-center justify-center bg-white p-2 rounded border border-gray-200 w-fit">
      <ReactBarcode 
        value={value} 
        width={width} 
        height={height} 
        displayValue={displayValue} 
        fontSize={12}
        margin={0}
      />
    </div>
  );
}