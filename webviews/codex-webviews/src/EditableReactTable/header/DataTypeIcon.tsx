import React, { ReactElement } from 'react';
import { DataTypes } from '../utils';
import TextIcon from '../img/Text';
import MultiIcon from '../img/Multi';
import HashIcon from '../img/Hash';

interface DataTypeIconProps {
  dataType: DataTypes;
}

export default function DataTypeIcon({ dataType }: DataTypeIconProps): ReactElement | null {
  function getPropertyIcon(dataType: DataTypes): ReactElement | null {
    switch (dataType as DataTypes) {
      case DataTypes.NUMBER:
        return <HashIcon />;
      case DataTypes.TEXT:
        return <TextIcon />;
      case DataTypes.SELECT:
        return <MultiIcon />;
      default:
        return null;
    }
  }

  return getPropertyIcon(dataType );
}
