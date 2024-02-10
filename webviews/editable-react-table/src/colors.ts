type GreyScaleValue = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export function grey(value: GreyScaleValue): string {
  const reference: Record<GreyScaleValue, string> = {
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#eeeeee',
    300: '#e0e0e0',
    400: '#bdbdbd',
    500: '#9e9e9e',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
  };

  return reference[value];
}