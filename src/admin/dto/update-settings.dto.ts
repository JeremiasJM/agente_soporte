import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateSettingsDto {
  @IsString()
  @IsNotEmpty()
  llmModel!: string;
}
