import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class CreateFaqDto {
  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsNotEmpty()
  answer!: string;

  @IsString()
  @IsOptional()
  category?: string;
}

export class UpdateFaqDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords?: string[];

  @IsString()
  @IsOptional()
  question?: string;

  @IsString()
  @IsOptional()
  answer?: string;

  @IsString()
  @IsOptional()
  category?: string;
}
