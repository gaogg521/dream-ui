import type { PersonalAgentAutomationConfig } from '@/common/types/employee/employeeTypes';
import { ADDITIONAL_SCENE_ICONS, personalSceneAvatarSrc } from '@/renderer/utils/scenes/sceneAvatar';
import { SCENE_ICONS } from '@/renderer/utils/scenes/personalScenes';
import { Button, Form, Message, Upload } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { resolveEmployeeAvatar } from '../utils/employeeAvatar';

const PORTRAITS = [...SCENE_ICONS, ...ADDITIONAL_SCENE_ICONS];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_EDGE = 256;

export type EmployeeAvatarValue = Pick<PersonalAgentAutomationConfig, 'avatarPreset' | 'avatarUrl'>;

type EmployeeAvatarFieldProps = {
  employeeId?: string;
  value: EmployeeAvatarValue;
  onChange: (value: EmployeeAvatarValue) => void;
  uploading: boolean;
  onUploadingChange: (uploading: boolean) => void;
  disabled: boolean;
};

async function encodeAvatar(file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Unsupported avatar format');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to resize avatar');
    const crop = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - crop) / 2,
      (image.height - crop) / 2,
      crop,
      crop,
      0,
      0,
      AVATAR_EDGE,
      AVATAR_EDGE
    );
    return canvas.toDataURL('image/png');
  } finally {
    image.close();
  }
}

const EmployeeAvatarField: React.FC<EmployeeAvatarFieldProps> = ({
  employeeId,
  value,
  onChange,
  uploading,
  onUploadingChange,
  disabled,
}) => {
  const { t } = useTranslation();
  const label = t('common.scenes.editor.icon');
  const locked = disabled || uploading;
  const preview = resolveEmployeeAvatar({ id: employeeId ?? '', automationConfig: value });

  const pickImage = async (file: File) => {
    if (locked) return false;
    onUploadingChange(true);
    try {
      onChange({ avatarUrl: await encodeAvatar(file) });
    } catch {
      Message.error(t('common.failed'));
    } finally {
      onUploadingChange(false);
    }
    // Upload supplies the file picker. The avatar is persisted with the form.
    return false;
  };

  return (
    <Form.Item label={label}>
      <div className='flex flex-col gap-8px'>
        <div className='flex flex-wrap items-center gap-8px'>
          <img
            src={preview}
            alt=''
            className='h-48px w-48px rounded-10px object-cover'
            data-testid='employee-avatar-preview'
          />
          <Upload accept={IMAGE_TYPES.join(',')} showUploadList={false} disabled={locked} beforeUpload={pickImage}>
            <Button size='small' loading={uploading} disabled={locked}>
              {t('settings.assistantAvatarUploadImage')}
            </Button>
          </Upload>
          <Button
            size='small'
            disabled={locked || (!value.avatarPreset && !value.avatarUrl)}
            onClick={() => onChange({})}
          >
            {t('common.default')}
          </Button>
        </div>
        <div className='flex flex-wrap gap-4px' role='group' aria-label={t('settings.assistantAvatarBuiltinTab')}>
          {PORTRAITS.map((icon, index) => {
            const selected = !value.avatarUrl && value.avatarPreset === icon;
            return (
              <Button
                key={icon}
                className='!h-36px !w-36px !rounded-8px !p-2px'
                type={selected ? 'primary' : 'secondary'}
                disabled={locked}
                aria-label={`${label} ${index + 1}`}
                aria-pressed={selected}
                onClick={() => onChange({ avatarPreset: icon })}
              >
                <img src={personalSceneAvatarSrc(icon)} alt='' className='h-30px w-30px rounded-5px object-cover' />
              </Button>
            );
          })}
        </div>
      </div>
    </Form.Item>
  );
};

export default EmployeeAvatarField;
